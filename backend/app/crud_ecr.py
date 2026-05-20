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
from app.models import User, Part, Assembly
from app.schemas_ecr import ECRCreate, ECREdit, ECRListParams, AffectedItemCreate

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


def get_ecrs(db: Session, params: ECRListParams, current_user=None):
    """查询 ECR 列表（分页 + 筛选）。非管理员只看与自己相关的 ECR"""
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

    total = q.count()
    ecrs = q.order_by(ECR.created_at.desc()).offset(
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
        })

    return items, total


def get_ecr(db: Session, ecr_id: uuid.UUID) -> ECR:
    """通过 ID 获取 ECR，不存在抛出 404"""
    ecr = db.query(ECR).filter(ECR.id == ecr_id).first()
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


def delete_ecr(db: Session, ecr_id: uuid.UUID):
    """删除 ECR（级联删除关联数据）"""
    ecr = get_ecr(db, ecr_id)
    db.delete(ecr)
    db.commit()


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

    if data.entity_type == "part":
        entity = db.query(Part).filter(Part.id == entity_id).first()
        if entity:
            entity_code = entity.code or ""
            entity_name = entity.name or ""
            entity_version = entity.version or ""
    elif data.entity_type == "assembly":
        entity = db.query(Assembly).filter(Assembly.id == entity_id).first()
        if entity:
            entity_code = entity.code or ""
            entity_name = entity.name or ""
            entity_version = entity.version or ""

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
