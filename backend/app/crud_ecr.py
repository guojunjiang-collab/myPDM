"""
ECR (Engineering Change Request) - CRUD Operations
==================================================
变更管理 - ECR 模块数据库操作
"""
import uuid
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from fastapi import HTTPException
from datetime import datetime, timezone

from app.database import SessionLocal
from app.models_ecr import ECR, ECRAffectedItem, ECRReviewRecord, ECRStatusLog
from app.models import User, BOMItem
from app.models_parts import PartMaster, PartRevision
from app.schemas_ecr import ECRCreate, ECREdit, ECRListParams, AffectedItemCreate
from . import notifications as _notif

# ─────────────────────────────────────────────────────
# 状态流转规则
# ─────────────────────────────────────────────────────
_ALLOWED_TRANSITIONS = {
    "draft":     {"reviewing", "closed"},
    "reviewing": {"approved", "rejected", "draft"},
    "approved":  {"closed"},
    "rejected":  {"closed"},
}


def generate_ecr_number(db: Session) -> str:
    """查询当前年份最大流水号，返回 'ECR-{YYYY}-{XXXXX}'"""
    current_year = datetime.now(timezone.utc).year
    prefix = f"ECR-{current_year}-"
    max_number = db.query(
        sqlfunc.max(ECR.ecr_number)
    ).filter(
        ECR.ecr_number.like(f"{prefix}%")
    ).scalar()
    if max_number:
        # 提取流水号
        seq_str = max_number[len(prefix):]
        try:
            seq = int(seq_str) + 1
        except ValueError:
            seq = 1
    else:
        seq = 1
    return f"{prefix}{seq:05d}"


def _build_reviewers_json(db: Session, reviewer_items: list) -> list:
    """将 ReviewerItem 列表转为 ECR.reviewers JSONB 格式（含冗余 userName/role）"""
    result = []
    for item in reviewer_items:
        # 兼容 Pydantic model 和 dict
        uid = item.user_id if hasattr(item, "user_id") else item.get("user_id", "")
        seq = item.seq if hasattr(item, "seq") else item.get("seq", 0)
        if not uid or not str(uid).strip():
            continue  # skip empty/invalid reviewer
        try:
            user_id = uuid.UUID(uid) if isinstance(uid, str) else uid
        except (ValueError, AttributeError):
            continue
        user = db.query(User).filter(User.id == user_id).first()
        if user:
            result.append({
                "seq": seq,
                "user_id": str(user_id),
                "user_name": user.real_name,
                "role": user.role,
            })
    return result


def create_ecr(db: Session, data: ECRCreate, creator_id: uuid.UUID) -> ECR:
    """创建 ECR，自动生成编号"""
    ecr_number = generate_ecr_number(db)
    reviewers_json = _build_reviewers_json(db, data.reviewers) if data.reviewers else []
    document_links_json = [dl.model_dump() if hasattr(dl, "model_dump") else dl for dl in data.document_links]

    db_ecr = ECR(
        ecr_number=ecr_number,
        title=data.title,
        description=data.description,
        reason=data.reason,
        priority=data.priority,
        category=data.category,
        status="draft",
        reviewers=reviewers_json,
        review_mode=data.review_mode,
        creator_id=creator_id,
        document_links=document_links_json,
    )
    db.add(db_ecr)
    db.commit()
    db.refresh(db_ecr)
    return db_ecr


def get_ecrs(
    db: Session, params: ECRListParams, current_user=None,
    include_deleted: bool = False, updated_since: float | None = None,
):
    """查询 ECR 列表（分页 + 筛选 + 排序）。非管理员只看与自己相关的 ECR"""
    from sqlalchemy import or_, cast, String
    q = db.query(ECR)

    # 非管理员用户：只看自己创建的或被指定为审批人的 ECR
    if current_user and current_user.role != "admin":
        uid = str(current_user.id)
        q = q.filter(
            or_(
                ECR.creator_id == current_user.id,
                ECR.reviewers.cast(String).contains(f'"user_id": "{uid}"'),
                ECR.cc_users.cast(String).contains(f'"user_id": "{uid}"')
            )
        )

    # 按状态筛选
    if params.status:
        q = q.filter(ECR.status == params.status)
    # 按优先级筛选
    if params.priority:
        q = q.filter(ECR.priority == params.priority)
    # 模糊搜索（标题 / 编号）
    if params.search:
        pattern = f"%{params.search}%"
        q = q.filter(
            (ECR.title.ilike(pattern)) | (ECR.ecr_number.ilike(pattern))
        )

    # 软删除过滤
    if not include_deleted:
        q = q.filter(ECR.deleted_at.is_(None))
    if updated_since:
        from datetime import datetime, timezone
        since_dt = datetime.fromtimestamp(updated_since, tz=timezone.utc)
        q = q.filter(
            (ECR.updated_at >= since_dt) |
            (ECR.deleted_at >= since_dt)
        )

    total = q.count()
    # 服务端排序（白名单映射，防注入）
    SORT_FIELDS = {
        'ecr_number': ECR.ecr_number,
        'title': ECR.title,
        'status': ECR.status,
        'priority': ECR.priority,
        'creator_name': None,  # 占位，实际 join users 表
        'created_at': ECR.created_at,
    }
    sort_field = params.sort_field or 'created_at'
    sort_order = params.sort_order or 'desc'
    if sort_field not in SORT_FIELDS:
        raise ValueError(f"Invalid sort_field: {sort_field}")
    if sort_order not in ('asc', 'desc'):
        raise ValueError(f"Invalid sort_order: {sort_order}")
    # creator_name 需关联 users 表
    if sort_field == 'creator_name':
        q = q.outerjoin(User, User.id == ECR.creator_id)
        col = User.real_name
    else:
        col = SORT_FIELDS[sort_field]
    order = col.asc().nullslast() if sort_order == 'asc' else col.desc().nullslast()
    ecrs = q.order_by(order).offset(
        (params.page - 1) * params.page_size
    ).limit(params.page_size).all()

    # 构建列表项
    items = []
    for ecr in ecrs:
        # 创建人姓名
        creator = db.query(User).filter(User.id == ecr.creator_id).first()
        creator_name = creator.real_name if creator else ""

        # 审批人数量
        reviewers_count = len(ecr.reviewers) if ecr.reviewers else 0
        # 已通过审批数量
        approved_count = db.query(ECRReviewRecord).filter(
            ECRReviewRecord.ecr_id == ecr.id,
            ECRReviewRecord.decision == "approved"
        ).count()
        # 受影响对象数量
        affected_count = db.query(ECRAffectedItem).filter(
            ECRAffectedItem.ecr_id == ecr.id
        ).count()

        items.append({
            "id": ecr.id,
            "ecr_number": ecr.ecr_number,
            "title": ecr.title,
            "status": ecr.status,
            "priority": ecr.priority,
            "category": ecr.category,
            "creator_id": str(ecr.creator_id),
            "creator_name": creator_name,
            "reviewers_count": reviewers_count,
            "approved_count": approved_count,
            "affected_count": affected_count,
            "created_at": ecr.created_at,
            "updated_at": ecr.updated_at,
            "deleted_at": ecr.deleted_at,
        })

    return items, total


def get_ecr(db: Session, ecr_id: uuid.UUID) -> ECR:
    """通过 ID 获取 ECR，不存在抛出 404（已删除的记录也视作不存在）"""
    ecr = db.query(ECR).filter(ECR.id == ecr_id, ECR.deleted_at.is_(None)).first()
    if not ecr:
        raise HTTPException(status_code=404, detail="ECR 不存在")
    return ecr


def update_ecr(db: Session, ecr_id: uuid.UUID, data: ECREdit) -> ECR:
    """更新 ECR（仅 draft 状态可编辑）"""
    ecr = get_ecr(db, ecr_id)
    if ecr.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态的 ECR 可以编辑")

    update_data = data.model_dump(exclude_unset=True)

    # reviewers 需要转换 JSONB 格式
    if "reviewers" in update_data and update_data["reviewers"] is not None:
        update_data["reviewers"] = _build_reviewers_json(db, update_data["reviewers"])

    # document_links 保持原始 list[dict] 格式
    if "document_links" in update_data and update_data["document_links"] is not None:
        update_data["document_links"] = [
            dl.model_dump() if hasattr(dl, "model_dump") else dl
            for dl in update_data["document_links"]
        ]

    for field, value in update_data.items():
        setattr(ecr, field, value)
    ecr.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(ecr)
    return ecr


def delete_ecr(db: Session, ecr_id: uuid.UUID) -> bool:
    """Soft delete ECR"""
    ecr = db.query(ECR).filter(ECR.id == ecr_id, ECR.deleted_at.is_(None)).first()
    if not ecr:
        return False
    ecr.deleted_at = sqlfunc.now()
    db.commit()
    return True


def change_ecr_status(
    db: Session,
    ecr_id: uuid.UUID,
    to_status: str,
    operator_id: uuid.UUID,
    comment: str | None = None,
    skip_log: bool = False,
) -> ECR:
    """变更 ECR 状态，校验流转合法性，写入状态日志"""
    ecr = get_ecr(db, ecr_id)
    from_status = ecr.status

    # 验证状态流转合法性
    allowed = _ALLOWED_TRANSITIONS.get(from_status, set())
    if to_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"不允许从 {from_status} 变更为 {to_status}"
        )

    # 查询操作人姓名
    operator = db.query(User).filter(User.id == operator_id).first()
    operator_name = operator.real_name if operator else ""

    # 创建状态日志（审批触发的状态变更不重复记录）
    if not skip_log:
        log = ECRStatusLog(
            ecr_id=ecr_id,
            from_status=from_status,
            to_status=to_status,
            operator_id=operator_id,
            operator_name=operator_name,
            comment=comment,
        )
        db.add(log)

    # 更新 ECR 状态
    ecr.status = to_status
    now = datetime.now(timezone.utc)
    if to_status == "approved" or to_status == "rejected":
        ecr.reviewed_at = now
    elif to_status == "closed":
        ecr.closed_at = now
    ecr.updated_at = now

    db.commit()
    db.refresh(ecr)

    # 站内通知：知会类事件（approved/rejected 通知创建人+cc；closed 仅通知 cc）
    _cc_ids = _notif.parse_uuids(c.get("user_id") for c in (ecr.cc_users or []))
    if to_status in ("approved", "rejected"):
        _evt = "ecr_approved" if to_status == "approved" else "ecr_rejected"
        _label = "审批通过" if to_status == "approved" else "审批驳回"
        _notif.create_notifications(
            db, recipient_ids=[ecr.creator_id, *_cc_ids], sender_id=operator_id,
            event_type=_evt, title=f"{ecr.ecr_number} {_label}",
            body=(comment or None), target_type="ecr", target_id=ecr.id,
            exclude_sender=True,
        )
    elif to_status == "closed" and _cc_ids:
        _notif.create_notifications(
            db, recipient_ids=_cc_ids, sender_id=operator_id,
            event_type="ecr_closed", title=f"{ecr.ecr_number} 已关闭",
            body=None, target_type="ecr", target_id=ecr.id, exclude_sender=True,
        )

    return ecr


def add_ecr_review_record(
    db: Session,
    ecr_id: uuid.UUID,
    reviewer_id: uuid.UUID,
    decision: str,
    comment: str | None = None
) -> ECRReviewRecord:
    """添加审批记录"""
    # 查询审批人姓名
    reviewer = db.query(User).filter(User.id == reviewer_id).first()
    if not reviewer:
        raise HTTPException(status_code=404, detail="审批人不存在")

    record = ECRReviewRecord(
        ecr_id=ecr_id,
        reviewer_id=reviewer_id,
        reviewer_name=reviewer.real_name,
        decision=decision,
        comment=comment,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def check_all_approved(db: Session, ecr_id: uuid.UUID) -> bool:
    """检查 ECR 是否所有审批人都已通过"""
    ecr = db.query(ECR).filter(ECR.id == ecr_id).first()
    if not ecr:
        return False

    reviewers = ecr.reviewers or []
    if not reviewers:
        return False

    # 提取所有审批人 user_id
    reviewer_ids = set()
    for r in reviewers:
        try:
            reviewer_ids.add(uuid.UUID(r["user_id"]))
        except (ValueError, KeyError):
            pass

    if not reviewer_ids:
        return False

    # 查询已通过的审批记录
    approved_records = db.query(ECRReviewRecord).filter(
        ECRReviewRecord.ecr_id == ecr_id,
        ECRReviewRecord.decision == "approved"
    ).all()

    approved_reviewer_ids = set(r.reviewer_id for r in approved_records)

    # 审批模式判断
    if ecr.review_mode == "any":
        # 或签：任一通过即可
        return len(approved_reviewer_ids & reviewer_ids) > 0
    else:
        # 会签：全部通过
        return reviewer_ids.issubset(approved_reviewer_ids)


def add_affected_item(
    db: Session,
    ecr_id: uuid.UUID,
    data: AffectedItemCreate
) -> ECRAffectedItem:
    """添加受影响对象（查询实体编码/名称/版本并冗余存储）"""
    # 验证 ECR 存在
    ecr = db.query(ECR).filter(ECR.id == ecr_id).first()
    if not ecr:
        raise HTTPException(status_code=404, detail="ECR 不存在")

    entity_id = uuid.UUID(data.entity_id) if isinstance(data.entity_id, str) else data.entity_id

    # 查询实体信息（零件或部件）
    entity_code = ""
    entity_name = ""
    entity_version = ""

    if data.entity_type in ("component", "part", "assembly"):
        entity = db.query(PartMaster).filter(PartMaster.id == entity_id).first()
        if entity:
            entity_code = entity.code or ""
            entity_name = entity.name or ""
            entity_version = _master_version(db, entity.id) or ""

    item = ECRAffectedItem(
        ecr_id=ecr_id,
        entity_type=data.entity_type,
        entity_id=entity_id,
        entity_code=entity_code,
        entity_name=entity_name,
        entity_version=entity_version,
        change_description=data.change_description,
        change_type=data.change_type,
        bom_impact={},
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def get_affected_items(db: Session, ecr_id: uuid.UUID) -> list:
    """获取 ECR 的所有受影响对象"""
    return db.query(ECRAffectedItem).filter(
        ECRAffectedItem.ecr_id == ecr_id
    ).order_by(ECRAffectedItem.created_at).all()


def delete_affected_item(db: Session, item_id: uuid.UUID):
    """删除受影响对象"""
    item = db.query(ECRAffectedItem).filter(ECRAffectedItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="受影响对象不存在")
    db.delete(item)
    db.commit()


# ─────────────────────────────────────────────────────
# BOM 溯源辅助函数（供 ECO 和 ECR 共享）
# ─────────────────────────────────────────────────────

def _revision_of_master(db: Session, master_id: uuid.UUID):
    """该 master 的最新有效 revision（按创建时间倒序）。"""
    return (
        db.query(PartRevision)
        .filter(PartRevision.master_id == master_id, PartRevision.deleted_at.is_(None))
        .order_by(PartRevision.created_at.desc())
        .first()
    )


def _master_version(db: Session, master_id: uuid.UUID) -> str:
    rev = _revision_of_master(db, master_id)
    return rev.version if rev else ""


def _parent_masters_of(db: Session, master_id: uuid.UUID) -> list:
    """查找使用该 master（其任一版本，取父版本当前迭代的有效 BOM 关系）的父 master 列表。
    返回 [(parent_master_id: UUID, quantity: float)]（父 master 去重）。"""
    from app.models_parts import PartIteration
    rev_ids = [
        r.id for r in db.query(PartRevision).filter(
            PartRevision.master_id == master_id, PartRevision.deleted_at.is_(None)
        ).all()
    ]
    if not rev_ids:
        return []
    items = (
        db.query(BOMItem)
        .join(PartIteration, PartIteration.id == BOMItem.iteration_id)
        .join(PartRevision, PartRevision.id == BOMItem.parent_revision_id)
        .filter(
            BOMItem.child_revision_id.in_(rev_ids),
            BOMItem.deleted_at.is_(None),
            PartRevision.deleted_at.is_(None),
            PartIteration.iteration == PartRevision.latest_iteration,
        )
        .all()
    )
    out = []
    seen = set()
    for bi in items:
        prev = db.query(PartRevision).filter(PartRevision.id == bi.parent_revision_id).first()
        if not prev:
            continue
        key = str(prev.master_id)
        if key in seen:
            continue
        seen.add(key)
        out.append((prev.master_id, float(bi.quantity or 1)))
    return out


def _get_upward_trace(db: Session, entity_type: str, entity_id: uuid.UUID) -> list:
    """向上追溯：查找引用该零部件（master）的所有父级（最多10层），构建树结构。
    基于 PartRevision BOM 模型（bom_items.child_revision_id → parent_revision_id，取父版本当前迭代）。"""
    obj = db.query(PartMaster).filter(PartMaster.id == entity_id).first()
    if not obj:
        return []

    # BFS 向上构建 child_master -> [parent_master] 映射
    child_to_parents: dict = {}
    nodes_by_id: dict = {}
    parent_meta: dict = {}
    visited = set()
    queue = [str(entity_id)]
    level = 0
    while queue and level < 10:
        next_q = []
        for cid in queue:
            if cid in visited:
                continue
            visited.add(cid)
            for parent_master_id, qty in _parent_masters_of(db, uuid.UUID(cid)):
                pk = str(parent_master_id)
                child_to_parents.setdefault(cid, [])
                if pk not in child_to_parents[cid]:
                    child_to_parents[cid].append(pk)
                if pk not in nodes_by_id:
                    pm = db.query(PartMaster).filter(PartMaster.id == parent_master_id).first()
                    if pm:
                        nodes_by_id[pk] = {
                            "entity_type": "assembly",
                            "entity_code": pm.code,
                            "entity_name": pm.name,
                            "entity_version": _master_version(db, parent_master_id),
                        }
                if pk not in parent_meta:
                    parent_meta[pk] = {"child_id": cid, "quantity": qty}
                next_q.append(pk)
        queue = next_q
        level += 1

    target_id = str(entity_id)
    target_qty = 0
    if target_id in child_to_parents and child_to_parents[target_id]:
        first_parent = child_to_parents[target_id][0]
        target_qty = parent_meta.get(first_parent, {}).get("quantity", 1)

    upward_chain = []

    # 变更对象自身（level 0）
    upward_chain.append({
        "level": 0,
        "entity_type": entity_type,
        "entity_id": target_id,
        "entity_code": obj.code,
        "entity_name": obj.name,
        "entity_version": _master_version(db, entity_id),
        "quantity": target_qty,
        "parent_entity_id": None,
        "parent_entity_code": None,
        "parent_target_version": None,
        "is_change_target": True,
        "action": "no_change",
        "target_version": None,
        "quantity_change": None,
        "change_description": "",
        "tree_path": "",
        "tree_connector": "",
        "has_sibling": False,
        "is_last_child": True,
    })

    # 递归向上构建树
    def build_upward_tree(node_id, depth, tree_prefix, is_last_of_parent):
        parents = child_to_parents.get(node_id, [])
        for i, parent_id in enumerate(parents):
            node_info = nodes_by_id.get(parent_id, {})
            qty = parent_meta.get(parent_id, {}).get("quantity", 1)
            is_last = (i == len(parents) - 1)

            connector = "└── " if is_last else "├── "
            child_prefix = "    " if is_last else "│   "

            upward_chain.append({
                "level": depth,
                "entity_type": node_info.get("entity_type", "assembly"),
                "entity_id": parent_id,
                "entity_code": node_info.get("entity_code", ""),
                "entity_name": node_info.get("entity_name", ""),
                "entity_version": node_info.get("entity_version", ""),
                "quantity": qty,
                "parent_entity_id": node_id,
                "parent_entity_code": obj.code if node_id == target_id else nodes_by_id.get(node_id, {}).get("entity_code"),
                "parent_target_version": None,
                "is_change_target": False,
                "action": "no_change",
                "target_version": None,
                "quantity_change": None,
                "change_description": "",
                "tree_path": tree_prefix,
                "tree_connector": connector,
                "has_sibling": len(parents) > 1,
                "is_last_child": is_last,
            })

            build_upward_tree(parent_id, depth + 1, tree_prefix + child_prefix, is_last)

    # 从变更目标开始向上
    if target_id in child_to_parents:
        parents = child_to_parents[target_id]
        for i, parent_id in enumerate(parents):
            node_info = nodes_by_id.get(parent_id, {})
            qty = parent_meta.get(parent_id, {}).get("quantity", 1)
            is_last = (i == len(parents) - 1)

            connector = "└── " if is_last else "├── "
            child_prefix = "    " if is_last else "│   "

            upward_chain.append({
                "level": 1,
                "entity_type": node_info.get("entity_type", "assembly"),
                "entity_id": parent_id,
                "entity_code": node_info.get("entity_code", ""),
                "entity_name": node_info.get("entity_name", ""),
                "entity_version": node_info.get("entity_version", ""),
                "quantity": qty,
                "parent_entity_id": target_id,
                "parent_entity_code": obj.code,
                "parent_target_version": None,
                "is_change_target": False,
                "action": "no_change",
                "target_version": None,
                "quantity_change": None,
                "change_description": "",
                "tree_path": "",
                "tree_connector": connector,
                "has_sibling": len(parents) > 1,
                "is_last_child": is_last,
            })

            build_upward_tree(parent_id, 2, child_prefix, is_last)

    return upward_chain


def _get_downward_trace(db: Session, entity_type: str, entity_id: uuid.UUID) -> list:
    """向下展开：取实体最新版本的一级 BOM 子项（基于 PartRevision 模型）。"""
    from app import crud_parts
    downward_items = []
    rev = _revision_of_master(db, entity_id)
    if not rev:
        return []
    try:
        children = crud_parts.get_bom_tree(db, rev.id)
    except Exception:
        children = []
    for c in children:
        downward_items.append({
            "entity_type": "assembly" if c.get("child_type") == "assembly" else "part",
            "entity_id": c.get("child_master_id"),
            "entity_code": c.get("child_code"),
            "entity_name": c.get("child_name") or "",
            "entity_version": c.get("child_version") or "",
            "quantity": float(c.get("quantity") or 1),
            "selected": False,
            "action": "no_change",
            "target_version": None,
            "quantity_change": None,
            "change_description": "",
            "parent_entity_id": str(entity_id),
            "parent_target_version": None,
        })
    return downward_items


def where_used_by_document(db, doc_revision_id) -> list:
    """反查：document_links 引用了该图文档版本的 ECR（按 ECR 去重）。"""
    from app.models_ecr import ECR
    rev_str = str(doc_revision_id)
    seen, out = set(), []
    for ecr in db.query(ECR).all():
        if str(ecr.id) in seen:
            continue
        if any(l.get("document_id") == rev_str for l in (ecr.document_links or [])):
            seen.add(str(ecr.id))
            out.append({"ecr_id": str(ecr.id), "ecr_number": ecr.ecr_number,
                        "title": ecr.title, "status": ecr.status})
    return out
