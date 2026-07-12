"""
ECO (Engineering Change Order) - CRUD Operations
==================================================
变更管理 - ECO 模块数据库操作（含执行逻辑）
"""
import uuid
from sqlalchemy.orm import Session
from sqlalchemy import func as sqlfunc
from fastapi import HTTPException
from datetime import datetime, timezone

from app.database import SessionLocal
from app.models_eco import ECO, ECOExecutionItem, ECOReviewRecord, ECOStatusLog
from app.models import User, BOMItem
from app.models_parts import PartMaster, PartRevision
from app.schemas_eco import ECOCreate, ECOEdit, ECOListParams, ECOExecutionItemCreate, ECOExecutionItemEdit
from app.crud import _get_next_version
from . import notifications as _notif

# ─────────────────────────────────────────────────────
# 状态流转规则
# ─────────────────────────────────────────────────────
_ALLOWED_TRANSITIONS = {
    "draft":     {"reviewing", "approved"},  # approved：提交时无审批人则自动批准
    "reviewing": {"approved", "rejected", "draft"},
    "approved":  {"executing"},
    "executing": {"completed"},
    "completed": set(),
    "rejected":  {"draft"},
}

VERSION_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _next_version(current: str) -> str:
    """计算下一个版本号：A→B, B→C, ..., Z→AA"""
    if not current:
        return "A"
    chars = list(current.upper())
    i = len(chars) - 1
    while i >= 0:
        idx = VERSION_CHARS.index(chars[i]) if chars[i] in VERSION_CHARS else -1
        if idx >= 0 and idx < len(VERSION_CHARS) - 1:
            chars[i] = VERSION_CHARS[idx + 1]
            return "".join(chars)
        elif idx == len(VERSION_CHARS) - 1:
            chars[i] = "A"
            i -= 1
        else:
            break
    return "A" + "".join(chars)


def _validate_transition(current_status: str, new_status: str):
    """校验状态流转合法性"""
    allowed = _ALLOWED_TRANSITIONS.get(current_status, set())
    if new_status not in allowed:
        raise HTTPException(
            status_code=400,
            detail=f"不允许从 {current_status} 转为 {new_status}"
        )


def _build_reviewers_json(db: Session, reviewer_items: list) -> list:
    """将 ReviewerItem 列表转为 ECO.reviewers JSONB 格式"""
    result = []
    for item in reviewer_items:
        uid = item.user_id if hasattr(item, "user_id") else item.get("user_id", "")
        seq = item.seq if hasattr(item, "seq") else item.get("seq", 0)
        if not uid or not str(uid).strip():
            continue
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


def _add_status_log(db: Session, eco_id: uuid.UUID, from_status: str, to_status: str,
                    operator_id: uuid.UUID, operator_name: str, comment: str = ""):
    """记录状态变更日志"""
    log = ECOStatusLog(
        eco_id=eco_id,
        from_status=from_status,
        to_status=to_status,
        operator_id=operator_id,
        operator_name=operator_name,
        comment=comment,
    )
    db.add(log)


# ─────────────────────────────────────────────────────
# 编号生成
# ─────────────────────────────────────────────────────

def generate_eco_number(db: Session) -> str:
    """查询当前年份最大流水号，返回 'ECO-{YYYY}-{XXXXX}'"""
    current_year = datetime.now(timezone.utc).year
    prefix = f"ECO-{current_year}-"
    max_number = db.query(
        sqlfunc.max(ECO.eco_number)
    ).filter(
        ECO.eco_number.like(f"{prefix}%")
    ).scalar()
    if max_number:
        seq_str = max_number[len(prefix):]
        try:
            seq = int(seq_str) + 1
        except ValueError:
            seq = 1
    else:
        seq = 1
    return f"{prefix}{seq:05d}"


# ─────────────────────────────────────────────────────
# ECO CRUD
# ─────────────────────────────────────────────────────

def create_eco(db: Session, data: ECOCreate, creator_id: uuid.UUID) -> ECO:
    """创建 ECO"""
    eco_number = generate_eco_number(db)
    reviewers_json = _build_reviewers_json(db, data.reviewers) if data.reviewers else []
    document_links_json = [dl.model_dump() if hasattr(dl, "model_dump") else dl for dl in data.document_links]
    ecr_id_val = uuid.UUID(data.ecr_id) if data.ecr_id else None

    db_eco = ECO(
        eco_number=eco_number,
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
        ecr_id=ecr_id_val,
    )
    db.add(db_eco)
    db.commit()
    db.refresh(db_eco)

    # 创建执行项
    if data.execution_items:
        for idx, item in enumerate(data.execution_items):
            ei = ECOExecutionItem(
                eco_id=db_eco.id,
                source=item.source if hasattr(item, "source") else "ecr",
                entity_type=item.entity_type,
                entity_name=item.entity_name,
                action=item.action,
                entity_id=uuid.UUID(item.entity_id) if item.entity_id else None,
                entity_code=item.entity_code,
                parent_entity_id=uuid.UUID(item.parent_entity_id) if item.parent_entity_id else None,
                detail=item.detail if getattr(item, "detail", None) else {},
                sort_order=idx,
            )
            db.add(ei)
        db.commit()

    # ECR 回填: 如果从 ECR 创建，更新 ECR.eco_id
    if ecr_id_val:
        from app.models_ecr import ECR
        ecr = db.query(ECR).filter(ECR.id == ecr_id_val).first()
        if ecr:
            ecr.eco_id = db_eco.id
            db.commit()

    return db_eco


def get_ecos(db: Session, params: ECOListParams, current_user=None,
              include_deleted: bool = False, updated_since: float | None = None):
    """查询 ECO 列表（分页 + 筛选）。非管理员只看与自己相关的 ECO"""
    from sqlalchemy import or_, cast, String
    q = db.query(ECO)
    if not include_deleted:
        q = q.filter(ECO.deleted_at.is_(None))

    if current_user and current_user.role != "admin":
        uid = str(current_user.id)
        q = q.filter(
            or_(
                ECO.creator_id == current_user.id,
                ECO.reviewers.cast(String).contains(f'"user_id": "{uid}"'),
                ECO.cc_users.cast(String).contains(f'"user_id": "{uid}"')
            )
        )

    if params.status:
        q = q.filter(ECO.status == params.status)
    if params.priority:
        q = q.filter(ECO.priority == params.priority)
    if params.search:
        pattern = f"%{params.search}%"
        q = q.filter(
            (ECO.title.ilike(pattern)) | (ECO.eco_number.ilike(pattern))
        )

    if updated_since:
        since_dt = datetime.fromtimestamp(updated_since, tz=timezone.utc)
        q = q.filter(
            (ECO.updated_at >= since_dt) |
            (ECO.deleted_at >= since_dt)
        )

    total = q.count()
    ecos = q.order_by(ECO.created_at.desc()).offset(
        (params.page - 1) * params.page_size
    ).limit(params.page_size).all()

    items = []
    for eco in ecos:
        creator = db.query(User).filter(User.id == eco.creator_id).first()
        creator_name = creator.real_name if creator else ""
        reviewers_count = len(eco.reviewers) if eco.reviewers else 0
        approved_count = db.query(ECOReviewRecord).filter(
            ECOReviewRecord.eco_id == eco.id,
            ECOReviewRecord.decision == "approved"
        ).count()
        execution_count = db.query(ECOExecutionItem).filter(
            ECOExecutionItem.eco_id == eco.id
        ).count()
        execution_completed_count = db.query(ECOExecutionItem).filter(
            ECOExecutionItem.eco_id == eco.id,
            ECOExecutionItem.status == "completed"
        ).count()

        ecr_number = None
        if eco.ecr_id:
            from app.models_ecr import ECR as ECRModel
            ecr = db.query(ECRModel).filter(ECRModel.id == eco.ecr_id).first()
            ecr_number = ecr.ecr_number if ecr else None

        items.append({
            "id": eco.id,
            "eco_number": eco.eco_number,
            "title": eco.title,
            "status": eco.status,
            "priority": eco.priority,
            "category": eco.category,
            "creator_name": creator_name,
            "reviewers_count": reviewers_count,
            "approved_count": approved_count,
            "execution_count": execution_count,
            "execution_completed_count": execution_completed_count,
            "ecr_id": str(eco.ecr_id) if eco.ecr_id else None,
            "ecr_number": ecr_number,
            "created_at": eco.created_at,
            "updated_at": eco.updated_at,
            "deleted_at": eco.deleted_at,
        })

    return items, total


def get_eco(db: Session, eco_id: uuid.UUID) -> ECO:
    """获取单个 ECO"""
    eco = db.query(ECO).filter(ECO.id == eco_id, ECO.deleted_at.is_(None)).first()
    if not eco:
        raise HTTPException(status_code=404, detail="ECO 不存在")
    return eco


def update_eco(db: Session, eco: ECO, data: ECOEdit):
    """更新 ECO。仅 draft 状态可编辑"""
    if eco.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态的 ECO 可以编辑")

    for field, value in data.model_dump(exclude_unset=True).items():
        if field == "reviewers" and value is not None:
            setattr(eco, field, _build_reviewers_json(db, value))
        elif field == "ecr_id" and value is not None:
            setattr(eco, field, uuid.UUID(value) if value else None)
        elif field == "document_links" and value is not None:
            setattr(eco, field, [dl.model_dump() if hasattr(dl, "model_dump") else dl for dl in value])
        elif field == "execution_items" and value is not None:
            # 合并更新执行项：匹配已有项保留升级状态，新增项创建
            existing_items = db.query(ECOExecutionItem).filter(
                ECOExecutionItem.eco_id == eco.id
            ).all()
            # 构建复合键 → 已有项映射（entity_id 优先，entity_code + source 兜底）
            old_map: dict = {}
            for old in existing_items:
                if old.entity_id:
                    old_map[str(old.entity_id)] = old
                if old.entity_code:
                    key = f"{old.entity_code}|{old.source}|{old.entity_type}"
                    if key not in old_map:
                        old_map[key] = old

            seen_ids = set()
            for idx, item in enumerate(value):
                ei_data = item if isinstance(item, dict) else item.model_dump() if hasattr(item, "model_dump") else {}
                eid = str(ei_data.get("entity_id")) if ei_data.get("entity_id") else None
                ecode = ei_data.get("entity_code")
                etype = ei_data.get("entity_type", "part")
                esource = ei_data.get("source", "ecr")

                # 匹配已有项
                matched = old_map.get(eid) if eid else old_map.get(f"{ecode}|{esource}|{etype}") if ecode else None

                if matched:
                    # 更新已有项（保留升级状态）
                    matched.action = ei_data.get("action", matched.action)
                    matched.entity_name = ei_data.get("entity_name", matched.entity_name)
                    matched.entity_code = ei_data.get("entity_code") or matched.entity_code
                    matched.entity_id = uuid.UUID(ei_data["entity_id"]) if ei_data.get("entity_id") else matched.entity_id
                    matched.parent_entity_id = uuid.UUID(ei_data["parent_entity_id"]) if ei_data.get("parent_entity_id") else matched.parent_entity_id
                    matched.detail = ei_data.get("detail") or matched.detail
                    matched.sort_order = idx
                    # 保留 new_entity_id, new_version, status（关键：不覆盖升级状态）
                    seen_ids.add(matched.id)
                else:
                    # 新建执行项
                    ei = ECOExecutionItem(
                        eco_id=eco.id,
                        source=esource,
                        entity_type=etype,
                        entity_name=ei_data.get("entity_name", ""),
                        action=ei_data.get("action", "no_change"),
                        entity_id=uuid.UUID(ei_data["entity_id"]) if ei_data.get("entity_id") else None,
                        entity_code=ecode,
                        parent_entity_id=uuid.UUID(ei_data["parent_entity_id"]) if ei_data.get("parent_entity_id") else None,
                        detail=ei_data.get("detail"),
                        status="pending",
                        sort_order=idx,
                    )
                    db.add(ei)

            # 删除不再需要的已有项
            for old in existing_items:
                if old.id not in seen_ids:
                    db.delete(old)
        else:
            setattr(eco, field, value)

    db.commit()
    db.refresh(eco)
    return eco


def delete_eco(db: Session, eco_id: uuid.UUID) -> bool:
    """软删除 ECO"""
    eco = db.query(ECO).filter(ECO.id == eco_id, ECO.deleted_at.is_(None)).first()
    if not eco:
        return False
    eco.deleted_at = sqlfunc.now()
    db.commit()
    return True


def collect_release_tree_entities(db: Session, release_items: list) -> list:
    """收集工程变更结果中所有关联件及其全部层级子项（去重、防循环、排除软删除）。

    返回 [(entity_type, entity), ...]（entity 为 Part / Assembly ORM 对象）。
    一键发布、发布状态校验、提交冻结共用同一遍历，确保对"树"的定义完全一致。
    """
    from app.models import BOMItem
    visited: set = set()
    entities: list = []
    stack: list = []
    for ri in release_items or []:
        et = ri.get("entity_type")
        eid = ri.get("entity_id")
        if not et or not eid:
            continue
        try:
            stack.append((et, uuid.UUID(str(eid))))
        except (ValueError, AttributeError):
            continue

    while stack:
        entity_type, entity_id = stack.pop()
        key = (entity_type, str(entity_id))
        if key in visited:
            continue
        visited.add(key)

        entity = db.query(PartMaster).filter(
            PartMaster.id == entity_id, PartMaster.deleted_at.is_(None)
        ).first()
        if not entity:
            continue
        entities.append((entity_type, entity))

        if entity_type != "part":
            children = db.query(BOMItem).filter(
                BOMItem.parent_type.in_(("assembly", "component")),
                BOMItem.parent_id == entity_id,
                BOMItem.deleted_at.is_(None),
            ).all()
            for c in children:
                child_type = "part" if c.child_type == "part" else "assembly"
                stack.append((child_type, c.child_id))
    return entities


def freeze_release_tree_on_submit(db: Session, eco: ECO) -> int:
    """提交审批：将工程变更结果树中所有"草稿"零部件置为"冻结"，并记录被冻结的实体用于日后精确解冻。

    仅冻结草稿件——已冻结/已发布/作废件保持原状且不计入 frozen_entities，
    这样撤回/驳回解冻时不会误动原本就冻结的件。不在此提交，由调用方统一提交。
    """
    frozen = []
    for et, entity in collect_release_tree_entities(db, eco.release_items or []):
        if entity.status == "draft":
            entity.status = "frozen"
            frozen.append({"entity_type": et, "entity_id": str(entity.id)})
    eco.frozen_entities = frozen
    return len(frozen)


def unfreeze_release_tree(db: Session, eco: ECO) -> int:
    """撤回/驳回回到草稿：仅将"本次提交时由系统冻结的"实体从"冻结"恢复为"草稿"。

    仅当实体当前仍为"冻结"时才恢复，避免覆盖审批期间发生的其它状态变化。不在此提交，由调用方统一提交。
    """
    count = 0
    for rec in (eco.frozen_entities or []):
        et = rec.get("entity_type")
        eid = rec.get("entity_id")
        if not et or not eid:
            continue
        try:
            uid = uuid.UUID(str(eid))
        except (ValueError, AttributeError):
            continue
        entity = db.query(PartMaster).filter(PartMaster.id == uid, PartMaster.deleted_at.is_(None)).first()
        if entity and entity.status == "frozen":
            entity.status = "draft"
            count += 1
    eco.frozen_entities = []
    return count


def change_eco_status(
    db: Session, eco_id: uuid.UUID, to_status: str,
    operator_id: uuid.UUID, comment: str = "", skip_log: bool = False
) -> ECO:
    """变更 ECO 状态，校验流转合法性，写入状态日志。

    副作用：提交审批（草稿→评审/已批准）时冻结工程变更结果中的草稿件；
    退回草稿（评审/驳回→草稿）时解冻本次提交所冻结的件——均与状态变更同一事务提交。
    """
    eco = get_eco(db, eco_id)
    from_status = eco.status
    allowed = _ALLOWED_TRANSITIONS.get(from_status, set())
    if to_status not in allowed:
        raise HTTPException(status_code=400, detail=f"不允许从 {from_status} 变更为 {to_status}")
    operator = db.query(User).filter(User.id == operator_id).first()
    operator_name = operator.real_name if operator else ""
    if not skip_log:
        log = ECOStatusLog(eco_id=eco_id, from_status=from_status, to_status=to_status,
                           operator_id=operator_id, operator_name=operator_name, comment=comment)
        db.add(log)
    eco.status = to_status
    now = datetime.now(timezone.utc)
    if to_status in ("approved", "rejected"): eco.reviewed_at = now
    elif to_status == "completed": eco.executed_at = now
    elif to_status == "closed": eco.closed_at = now
    eco.updated_at = now
    # 提交审批：冻结草稿件，防止审批期间工程师手动修改零部件信息
    if from_status == "draft" and to_status in ("reviewing", "approved"):
        freeze_release_tree_on_submit(db, eco)
    # 退回草稿：解冻本次提交所冻结的件，便于工程师按意见修改
    elif to_status == "draft" and from_status in ("reviewing", "rejected"):
        unfreeze_release_tree(db, eco)
    db.commit()
    db.refresh(eco)

    # 站内通知：知会类事件（approved/rejected 通知创建人+cc；executing/completed 仅通知 cc）
    _cc_ids = _notif.parse_uuids(c.get("user_id") for c in (eco.cc_users or []))
    if to_status in ("approved", "rejected"):
        _evt = "eco_approved" if to_status == "approved" else "eco_rejected"
        _label = "审批通过" if to_status == "approved" else "审批驳回"
        _notif.create_notifications(
            db, recipient_ids=[eco.creator_id, *_cc_ids], sender_id=operator_id,
            event_type=_evt, title=f"{eco.eco_number} {_label}",
            body=(comment or None), target_type="eco", target_id=eco.id, exclude_sender=True,
        )
    elif to_status == "executing" and _cc_ids:
        _notif.create_notifications(
            db, recipient_ids=_cc_ids, sender_id=operator_id,
            event_type="eco_executing", title=f"{eco.eco_number} 开始执行",
            body=None, target_type="eco", target_id=eco.id, exclude_sender=True,
        )
    elif to_status == "completed" and _cc_ids:
        _notif.create_notifications(
            db, recipient_ids=_cc_ids, sender_id=operator_id,
            event_type="eco_closed", title=f"{eco.eco_number} 已完成",
            body=None, target_type="eco", target_id=eco.id, exclude_sender=True,
        )

    return eco


def add_eco_review_record(db: Session, eco_id: uuid.UUID, reviewer_id: uuid.UUID,
                          decision: str, comment: str = "") -> ECOReviewRecord:
    """添加审批记录"""
    reviewer = db.query(User).filter(User.id == reviewer_id).first()
    if not reviewer: raise HTTPException(status_code=404, detail="审批人不存在")
    r = ECOReviewRecord(eco_id=eco_id, reviewer_id=reviewer_id, reviewer_name=reviewer.real_name,
                        decision=decision, comment=comment)
    db.add(r); db.commit(); db.refresh(r)
    return r


def check_all_approved(db: Session, eco_id: uuid.UUID) -> bool:
    """检查是否所有审批人都已通过"""
    eco = db.query(ECO).filter(ECO.id == eco_id).first()
    if not eco: return False
    reviewers = eco.reviewers or []
    if not reviewers: return False
    rids = set()
    for r in reviewers:
        try: rids.add(uuid.UUID(r["user_id"]))
        except (ValueError, KeyError): pass
    if not rids: return False
    approved = db.query(ECOReviewRecord).filter(ECOReviewRecord.eco_id == eco_id, ECOReviewRecord.decision == "approved").all()
    aids = set(r.reviewer_id for r in approved)
    return len(aids & rids) > 0 if eco.review_mode == "any" else rids.issubset(aids)


def clear_review_records(db: Session, eco_id: uuid.UUID):
    """清空审批记录"""
    db.query(ECOReviewRecord).filter(ECOReviewRecord.eco_id == eco_id).delete()
    db.commit()


# ─────────────────────────────────────────────────────
# 审批流程
# ─────────────────────────────────────────────────────

def submit_eco(db: Session, eco: ECO, user: User):
    """提交评审"""
    _validate_transition(eco.status, "reviewing")
    # 清除旧审批记录
    db.query(ECOReviewRecord).filter(ECOReviewRecord.eco_id == eco.id).delete()
    _add_status_log(db, eco.id, eco.status, "reviewing", user.id, user.real_name, "提交评审")
    eco.status = "reviewing"
    db.commit()
    db.refresh(eco)
    return eco


def withdraw_eco(db: Session, eco: ECO, user: User):
    """撤回评审"""
    _validate_transition(eco.status, "draft")
    db.query(ECOReviewRecord).filter(ECOReviewRecord.eco_id == eco.id).delete()
    _add_status_log(db, eco.id, eco.status, "draft", user.id, user.real_name, "撤回评审")
    eco.status = "draft"
    db.commit()
    db.refresh(eco)
    return eco


def review_eco(db: Session, eco: ECO, reviewer: User, decision: str, comment: str = ""):
    """审批操作"""
    if eco.status != "reviewing":
        raise HTTPException(status_code=400, detail="ECO 不在评审中状态")

    # 检查审批人权限
    reviewer_id_str = str(reviewer.id)
    is_admin = reviewer.role == "admin"
    is_reviewer = any(
        r.get("user_id") == reviewer_id_str for r in (eco.reviewers or [])
    )
    if not is_admin and not is_reviewer:
        raise HTTPException(status_code=403, detail="您不是该 ECO 的指定审批人")

    # 创建审批记录
    record = ECOReviewRecord(
        eco_id=eco.id,
        reviewer_id=reviewer.id,
        reviewer_name=reviewer.real_name,
        decision=decision,
        comment=comment,
    )
    db.add(record)
    db.commit()

    if decision == "approved":
        # 检查是否所有审批人都通过了
        if eco.review_mode == "all":
            all_reviewers = {r.get("user_id") for r in (eco.reviewers or [])}
            approved_reviewers = {
                str(r.reviewer_id) for r in db.query(ECOReviewRecord).filter(
                    ECOReviewRecord.eco_id == eco.id,
                    ECOReviewRecord.decision == "approved"
                ).all()
            }
            if all_reviewers and all_reviewers.issubset(approved_reviewers):
                _add_status_log(db, eco.id, eco.status, "approved", reviewer.id, reviewer.real_name, "全部审批通过")
                eco.status = "approved"
                eco.reviewed_at = datetime.now(timezone.utc)
        else:
            # 或签：任一通过即批准
            _add_status_log(db, eco.id, eco.status, "approved", reviewer.id, reviewer.real_name, "或签通过")
            eco.status = "approved"
            eco.reviewed_at = datetime.now(timezone.utc)
    elif decision == "rejected":
        _add_status_log(db, eco.id, eco.status, "rejected", reviewer.id, reviewer.real_name, comment or "驳回")
        eco.status = "rejected"
    elif decision == "returned":
        _add_status_log(db, eco.id, eco.status, "draft", reviewer.id, reviewer.real_name, comment or "退回修改")
        eco.status = "draft"
        db.query(ECOReviewRecord).filter(ECOReviewRecord.eco_id == eco.id).delete()

    db.commit()
    db.refresh(eco)
    return eco


def close_eco(db: Session, eco: ECO, user: User, comment: str = ""):
    """关闭 ECO"""
    _validate_transition(eco.status, "closed")
    _add_status_log(db, eco.id, eco.status, "closed", user.id, user.real_name, comment or "关闭")
    eco.status = "closed"
    eco.closed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(eco)
    return eco


# ─────────────────────────────────────────────────────
# 执行项 CRUD
# ─────────────────────────────────────────────────────

def get_execution_items(db: Session, eco_id: uuid.UUID) -> list:
    """获取 ECO 的执行项列表"""
    items = db.query(ECOExecutionItem).filter(
        ECOExecutionItem.eco_id == eco_id
    ).order_by(ECOExecutionItem.sort_order).all()
    return items


def get_execution_item(db: Session, item_id: uuid.UUID):
    """获取单个执行项"""
    return db.query(ECOExecutionItem).filter(
        ECOExecutionItem.id == item_id
    ).first()


def add_execution_item(db: Session, eco: ECO, data: ECOExecutionItemCreate) -> ECOExecutionItem:
    """添加执行项"""
    if eco.status not in ("draft",):
        raise HTTPException(status_code=400, detail="只有草稿状态的 ECO 可以添加执行项")

    item = ECOExecutionItem(
        eco_id=eco.id,
        source=data.source,
        entity_type=data.entity_type,
        entity_name=data.entity_name,
        action=data.action,
        entity_id=uuid.UUID(data.entity_id) if data.entity_id else None,
        entity_code=data.entity_code,
        parent_entity_id=uuid.UUID(data.parent_entity_id) if data.parent_entity_id else None,
        sort_order=data.sort_order if hasattr(data, "sort_order") else 0,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def update_execution_item(db: Session, item: ECOExecutionItem, data: dict):
    """更新执行项"""
    updatable = {"entity_name", "entity_code", "action", "sort_order", "parent_entity_id"}
    for field, value in data.items():
        if field in updatable and value is not None:
            setattr(item, field, value)
    db.commit()
    db.refresh(item)
    return item


def delete_execution_item(db: Session, item: ECOExecutionItem):
    """删除执行项"""
    db.delete(item)
    db.commit()


def remove_execution_item(db: Session, eco_id: uuid.UUID, item_id: uuid.UUID):
    """通过 ID 删除执行项"""
    item = db.query(ECOExecutionItem).filter(
        ECOExecutionItem.id == item_id, ECOExecutionItem.eco_id == eco_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="执行项不存在")
    db.delete(item)
    db.commit()


# ─────────────────────────────────────────────────────
# 执行逻辑（核心）
# ─────────────────────────────────────────────────────

def _clone_entity(db: Session, entity, entity_type: str) -> uuid.UUID:
    """克隆实体创建新版本，返回新实体 ID。
    零件：基础字段+自定义字段沿用，关联图文档清空。
    部件：基础字段+自定义字段+子项列表沿用，关联图文档清空。"""
    new_version = _get_next_version(db, PartMaster, entity.code)

    new_entity = PartMaster(
        code=entity.code,
        name=entity.name,
        spec=getattr(entity, 'spec', None),
        type=entity_type if entity_type == "part" else "assembly",
        creator_id=getattr(entity, 'creator_id', None),
    )
    db.add(new_entity)
    db.flush()

    # 复制子项列表（BOM）- 仅对部件类型
    if entity_type not in ("part",):
        from app.models import BOMItem
        old_bom = db.query(BOMItem).filter(
            BOMItem.parent_type.in_(("assembly", "component")),
            BOMItem.parent_id == entity.id
        ).all()
        for bom in old_bom:
            new_bom = BOMItem(
                parent_type="component",
                parent_id=new_entity.id,
                child_type=bom.child_type,
                child_id=bom.child_id,
                quantity=bom.quantity,
            )
            db.add(new_bom)

    return new_entity.id, new_version


def _get_upward_chain_by_impact(db: Session, ecr_affected_items, entity_type: str, entity_id: uuid.UUID) -> list:
    """从 ECR 受影响对象中获取向上溯源链中有变更标记的父项"""
    # 查找匹配的 affected_item
    for ai in ecr_affected_items:
        if str(ai.entity_id) == str(entity_id) and ai.entity_type == entity_type:
            bom_impact = ai.bom_impact or {}
            upward_chain = bom_impact.get("upward_chain", [])
            # 只返回标记为升级/变更的父项
            return [
                node for node in upward_chain
                if node.get("action") in ("upgrade", "qty_change", "delete")
            ]
    return []


def _execute_create(db: Session, item: ECOExecutionItem) -> dict:
    """执行新建操作"""
    entity_data = {
        "code": item.entity_code or f"NEW-{uuid.uuid4().hex[:8].upper()}",
        "name": item.entity_name,
        "type": item.entity_type if item.entity_type in ("part", "assembly") else "assembly",
    }
    new_entity = PartMaster(**entity_data)
    db.add(new_entity)
    db.flush()

    # 如果指定了父项，创建 BOM 关系（新零件不影响已有结构，不做 BOM 影响分析）
    if item.parent_entity_id:
        bom = BOMItem(
            parent_type="component",
            parent_id=item.parent_entity_id,
            child_type=item.entity_type,
            child_id=new_entity.id,
            quantity=1,
        )
        db.add(bom)

    return {"new_entity_id": str(new_entity.id), "new_version": "A"}


def _execute_upgrade(db: Session, item: ECOExecutionItem, ecr_affected_items) -> dict:
    """执行升版操作"""
    entity_id = item.entity_id
    entity_type = item.entity_type

    entity = db.query(PartMaster).filter(PartMaster.id == entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail=f"实体 {entity_id} 不存在")

    new_id, new_version = _clone_entity(db, entity, entity_type)

    # 更新 BOM 引用（将 child_id 指向新版本）
    db.query(BOMItem).filter(
        BOMItem.child_type == entity_type,
        BOMItem.child_id == entity_id
    ).update({"child_id": new_id})

    # 仅在 ECR 向上溯源链中有变更标记的父项才升版
    cascade_parents = _get_upward_chain_by_impact(db, ecr_affected_items, entity_type, entity_id)
    cascaded = []
    for parent_node in cascade_parents:
        parent_type = parent_node.get("entity_type", "assembly")
        parent_id_str = parent_node.get("entity_id")
        if parent_id_str:
            parent_id = uuid.UUID(parent_id_str)
            parent = db.query(PartMaster).filter(PartMaster.id == parent_id).first()
            if parent:
                pnew_id, _ = _clone_entity(db, parent, parent_type)
                cascaded.append(str(pnew_id))

    return {"new_entity_id": str(new_id), "new_version": new_version, "cascade_upgraded_parents": cascaded}


def _execute_qty_change(db: Session, item: ECOExecutionItem, ecr_affected_items) -> dict:
    """执行数量变更"""
    parent_id = item.parent_entity_id
    entity_id = item.entity_id
    entity_type = item.entity_type

    # 父项升版
    parent = db.query(PartMaster).filter(PartMaster.id == parent_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail=f"父项装配件 {parent_id} 不存在")

    new_parent_id, _ = _clone_entity(db, parent, "assembly")

    # 复制旧 BOM 项到新父项
    old_bom_items = db.query(BOMItem).filter(
        BOMItem.parent_type.in_(("assembly", "component")),
        BOMItem.parent_id == parent_id
    ).all()

    for bom in old_bom_items:
        new_bom = BOMItem(
            parent_type="component",
            parent_id=new_parent_id,
            child_type=bom.child_type,
            child_id=bom.child_id,
            quantity=bom.quantity,
        )
        db.add(new_bom)

    # 修改目标 BOM 项的数量
    detail = item.detail or {}
    old_qty = detail.get("old_quantity", 0)
    new_qty = detail.get("new_quantity", 0)
    target_bom = db.query(BOMItem).filter(
        BOMItem.parent_type.in_(("assembly", "component")),
        BOMItem.parent_id == new_parent_id,
        BOMItem.child_type == entity_type,
        BOMItem.child_id == entity_id
    ).first()
    if target_bom:
        target_bom.quantity = new_qty

    # 级联升版
    cascade_parents = _get_upward_chain_by_impact(db, ecr_affected_items, "assembly", parent_id)
    cascaded = []
    for parent_node in cascade_parents:
        p_id_str = parent_node.get("entity_id")
        if p_id_str:
            p_id = uuid.UUID(p_id_str)
            p = db.query(PartMaster).filter(PartMaster.id == p_id).first()
            if p:
                pnew_id, _ = _clone_entity(db, p, "assembly")
                cascaded.append(str(pnew_id))

    return {"parent_new_entity_id": str(new_parent_id), "old_quantity": old_qty, "new_quantity": new_qty}


def _execute_delete(db: Session, item: ECOExecutionItem, ecr_affected_items) -> dict:
    """执行删除 BOM 关系"""
    parent_id = item.parent_entity_id
    entity_id = item.entity_id
    entity_type = item.entity_type

    # 父项升版
    parent = db.query(PartMaster).filter(PartMaster.id == parent_id).first()
    if not parent:
        raise HTTPException(status_code=404, detail=f"父项装配件 {parent_id} 不存在")

    new_parent_id, _ = _clone_entity(db, parent, "assembly")

    # 复制旧 BOM 项到新父项（排除被删除项）
    old_bom_items = db.query(BOMItem).filter(
        BOMItem.parent_type.in_(("assembly", "component")),
        BOMItem.parent_id == parent_id
    ).all()

    for bom in old_bom_items:
        if str(bom.child_id) == str(entity_id):
            continue  # 跳过被删除项
        new_bom = BOMItem(
            parent_type="component",
            parent_id=new_parent_id,
            child_type=bom.child_type,
            child_id=bom.child_id,
            quantity=bom.quantity,
        )
        db.add(new_bom)

    # 级联升版
    cascade_parents = _get_upward_chain_by_impact(db, ecr_affected_items, "assembly", parent_id)
    cascaded = []
    for parent_node in cascade_parents:
        p_id_str = parent_node.get("entity_id")
        if p_id_str:
            p_id = uuid.UUID(p_id_str)
            p = db.query(PartMaster).filter(PartMaster.id == p_id).first()
            if p:
                pnew_id, _ = _clone_entity(db, p, "assembly")
                cascaded.append(str(pnew_id))

    return {"parent_new_entity_id": str(new_parent_id), "removed_child_id": str(entity_id)}


def execute_item(db: Session, item: ECOExecutionItem) -> ECOExecutionItem:
    """执行单个执行项"""
    if item.status not in ("pending", "failed"):
        raise HTTPException(status_code=400, detail=f"执行项状态为 {item.status}，不可执行")

    item.status = "in_progress"
    db.commit()

    try:
        # 获取 ECR 受影响对象（用于级联升版判断）
        eco = db.query(ECO).filter(ECO.id == item.eco_id).first()
        ecr_affected_items = []
        if eco and eco.ecr_id:
            from app.models_ecr import ECRAffectedItem
            ecr_affected_items = db.query(ECRAffectedItem).filter(
                ECRAffectedItem.ecr_id == eco.ecr_id
            ).all()

        if item.action == "create":
            detail = _execute_create(db, item)
        elif item.action == "upgrade":
            detail = _execute_upgrade(db, item, ecr_affected_items)
        elif item.action == "qty_change":
            detail = _execute_qty_change(db, item, ecr_affected_items)
        elif item.action == "delete":
            detail = _execute_delete(db, item, ecr_affected_items)
        else:
            detail = {}

        item.detail = detail
        item.status = "completed"
        item.executed_at = datetime.now(timezone.utc)

        if detail.get("new_entity_id"):
            item.new_entity_id = uuid.UUID(detail["new_entity_id"])
        if detail.get("new_version"):
            item.new_version = detail["new_version"]
        if detail.get("parent_new_entity_id"):
            item.parent_new_entity_id = uuid.UUID(detail["parent_new_entity_id"])

        db.commit()
        db.refresh(item)

        # 检查是否所有执行项都已完成
        _check_eco_completion(db, item.eco_id)

    except Exception as e:
        item.status = "failed"
        item.error_message = str(e)
        db.commit()
        db.refresh(item)

    return item


def execute_all(db: Session, eco: ECO) -> list:
    """一键执行全部（按 sort_order 排序）"""
    if eco.status != "approved":
        raise HTTPException(status_code=400, detail="只有已批准状态的 ECO 可以执行")

    eco.status = "executing"
    _add_status_log(db, eco.id, "approved", "executing",
                    eco.creator_id, "", "开始执行")
    db.commit()

    items = db.query(ECOExecutionItem).filter(
        ECOExecutionItem.eco_id == eco.id
    ).order_by(ECOExecutionItem.sort_order).all()

    results = []
    for item in items:
        if item.status in ("completed", "skipped"):
            results.append({"id": str(item.id), "status": item.status})
            continue
        try:
            executed = execute_item(db, item)
            results.append({"id": str(executed.id), "status": executed.status})
        except Exception:
            results.append({"id": str(item.id), "status": "failed"})

    return results


def start_execution(db: Session, eco: ECO, user: User):
    """开始执行（approved → executing）"""
    _validate_transition(eco.status, "executing")
    _add_status_log(db, eco.id, eco.status, "executing", user.id, user.real_name, "开始执行")
    eco.status = "executing"
    db.commit()
    db.refresh(eco)
    return eco


def _check_eco_completion(db: Session, eco_id: uuid.UUID):
    """检查 ECO 所有执行项是否完成，自动转 completed"""
    total = db.query(ECOExecutionItem).filter(
        ECOExecutionItem.eco_id == eco_id
    ).count()
    completed = db.query(ECOExecutionItem).filter(
        ECOExecutionItem.eco_id == eco_id,
        ECOExecutionItem.status.in_(["completed", "skipped"])
    ).count()
    if total > 0 and total == completed:
        eco = db.query(ECO).filter(ECO.id == eco_id).first()
        if eco and eco.status == "executing":
            eco.status = "completed"
            eco.executed_at = datetime.now(timezone.utc)
            db.commit()
            _cc_ids = _notif.parse_uuids(c.get("user_id") for c in (eco.cc_users or []))
            if _cc_ids:
                _notif.create_notifications(
                    db, recipient_ids=_cc_ids, sender_id=None,
                    event_type="eco_closed", title=f"{eco.eco_number} 已完成",
                    body=None, target_type="eco", target_id=eco.id, exclude_sender=True,
                )


# ─────────────────────────────────────────────────────
# 知会操作
# ─────────────────────────────────────────────────────

def add_cc_users(db: Session, eco: ECO, user_ids: list, sender_id=None):
    """添加知会用户"""
    current = list(eco.cc_users or [])
    existing_ids = {u.get("user_id") for u in current}
    newly_added = []
    for uid in user_ids:
        if uid in existing_ids:
            continue
        user = db.query(User).filter(User.id == uuid.UUID(uid)).first()
        if user:
            current.append({"user_id": uid, "user_name": user.real_name})
            newly_added.append(user.id)
    eco.cc_users = current
    db.commit()
    db.refresh(eco)
    if newly_added:
        _notif.create_notifications(
            db, recipient_ids=newly_added, sender_id=sender_id,
            event_type="cc_added", title=f"你被加为 {eco.eco_number} 知会人",
            body=None, target_type="eco", target_id=eco.id, exclude_sender=True,
        )
    return eco


def remove_cc_user(db: Session, eco: ECO, user_id: str):
    """移除知会用户"""
    current = list(eco.cc_users or [])
    current = [u for u in current if u.get("user_id") != user_id]
    eco.cc_users = current
    db.commit()
    db.refresh(eco)
    return eco


# ─────────────────────────────────────────────────────
# 状态日志
# ─────────────────────────────────────────────────────

def get_status_logs(db: Session, eco_id: uuid.UUID) -> list:
    """获取 ECO 状态变更日志"""
    return db.query(ECOStatusLog).filter(
        ECOStatusLog.eco_id == eco_id
    ).order_by(ECOStatusLog.created_at).all()


# ─────────────────────────────────────────────────────
# BOM 溯源（复用 ECR 的 BOM 溯源逻辑）
# ─────────────────────────────────────────────────────

def get_bom_trace(db: Session, entity_type: str, entity_id: uuid.UUID) -> dict:
    """BOM 双向溯源"""
    from app.crud_ecr import _get_upward_trace, _get_downward_trace
    upward = _get_upward_trace(db, entity_type, entity_id)
    downward = _get_downward_trace(db, entity_type, entity_id)
    return {"upward_chain": upward, "downward_items": downward}
