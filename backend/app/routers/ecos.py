"""
ECO (Engineering Change Order) - API Router
=============================================
变更管理 - ECO 模块 API 端点
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, Part, Assembly, BOMItem
from app.models_eco import ECO, ECOExecutionItem, ECOReviewRecord, ECOStatusLog
from app import crud_eco, schemas_eco
from app.routers.auth import require_role

router = APIRouter(prefix="/ecos", tags=["变更管理-ECO"])


# ─────────────────────────────────────────────────────
# 辅助：构建 ECO 详情响应
# ─────────────────────────────────────────────────────
def _build_eco_detail(db: Session, eco: ECO) -> dict:
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

    reviewers_detail = []
    for r in (eco.reviewers or []):
        reviewers_detail.append({
            "seq": r.get("seq", 0), "user_id": r.get("user_id", ""),
            "user_name": r.get("user_name", ""), "role": r.get("role", ""),
        })

    review_records = db.query(ECOReviewRecord).filter(
        ECOReviewRecord.eco_id == eco.id
    ).order_by(ECOReviewRecord.created_at).all()
    review_record_items = [
        {"id": str(r.id), "reviewer_id": str(r.reviewer_id),
         "reviewer_name": r.reviewer_name or "", "decision": r.decision,
         "comment": r.comment, "created_at": r.created_at}
        for r in review_records
    ]

    status_logs = db.query(ECOStatusLog).filter(
        ECOStatusLog.eco_id == eco.id
    ).order_by(ECOStatusLog.created_at).all()
    status_log_items = [
        {"id": str(l.id), "from_status": l.from_status, "to_status": l.to_status,
         "operator_name": l.operator_name or "", "comment": l.comment,
         "created_at": l.created_at}
        for l in status_logs
    ]

    execution_items = db.query(ECOExecutionItem).filter(
        ECOExecutionItem.eco_id == eco.id
    ).order_by(ECOExecutionItem.sort_order).all()
    execution_item_list = []
    for ei in execution_items:
        # 查询新版实体的状态
        new_entity_status = None
        if ei.new_entity_id:
            model_cls = Part if ei.entity_type == "part" else Assembly
            new_ent = db.query(model_cls).filter(model_cls.id == ei.new_entity_id).first()
            if new_ent:
                new_entity_status = new_ent.status

        execution_item_list.append({
            "id": str(ei.id), "source": ei.source, "entity_type": ei.entity_type,
            "entity_id": str(ei.entity_id) if ei.entity_id else None,
            "entity_code": ei.entity_code or "", "entity_name": ei.entity_name,
            "action": ei.action, "status": ei.status, "detail": ei.detail or {},
            "new_entity_id": str(ei.new_entity_id) if ei.new_entity_id else None,
            "new_version": ei.new_version,
            "new_entity_status": new_entity_status,
            "parent_entity_id": str(ei.parent_entity_id) if ei.parent_entity_id else None,
            "parent_new_entity_id": str(ei.parent_new_entity_id) if ei.parent_new_entity_id else None,
            "error_message": ei.error_message, "sort_order": ei.sort_order,
            "executed_at": ei.executed_at}
        )

    executor_name = ""
    if eco.executor_id:
        executor = db.query(User).filter(User.id == eco.executor_id).first()
        executor_name = executor.real_name if executor else ""

    ecr_number = None
    if eco.ecr_id:
        from app.models_ecr import ECR as ECRModel
        ecr_obj = db.query(ECRModel).filter(ECRModel.id == eco.ecr_id).first()
        if ecr_obj:
            ecr_number = ecr_obj.ecr_number

    return {
        "id": eco.id, "eco_number": eco.eco_number, "title": eco.title,
        "status": eco.status, "priority": eco.priority, "category": eco.category,
        "creator_name": creator_name, "reviewers_count": reviewers_count,
        "approved_count": approved_count, "execution_count": execution_count,
        "execution_completed_count": execution_completed_count,
        "ecr_id": str(eco.ecr_id) if eco.ecr_id else None, "ecr_number": ecr_number,
        "created_at": eco.created_at, "updated_at": eco.updated_at,
        "description": eco.description, "reason": eco.reason,
        "review_mode": eco.review_mode, "reviewers": reviewers_detail,
        "review_records": review_record_items,
        "document_links": eco.document_links or [],
        "execution_items": execution_item_list,
        "status_logs": status_log_items,
        "cc_users": eco.cc_users or [],
        "release_items": eco.release_items or [],
        "executor_name": executor_name,
        "executor_id": str(eco.executor_id) if eco.executor_id else None,
        "reviewed_at": eco.reviewed_at, "executed_at": eco.executed_at,
        "closed_at": eco.closed_at,
    }


# ─────────────────────────────────────────────────────
# 1. ECO 列表
# ─────────────────────────────────────────────────────
@router.get("/")
async def list_ecos(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
    search: str = Query(None), status: str = Query(None), priority: str = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
):
    params = schemas_eco.ECOListParams(page=page, page_size=page_size, search=search, status=status, priority=priority)
    items, total = crud_eco.get_ecos(db, params, current_user)
    items_serialized = []
    for item in items:
        s = {**item, "id": str(item["id"])}
        items_serialized.append(s)
    return {"items": items_serialized, "total": total, "page": page, "page_size": page_size}


# ─────────────────────────────────────────────────────
# 2. 创建 ECO
# ─────────────────────────────────────────────────────
@router.post("/")
async def create_eco(
    data: schemas_eco.ECOCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    eco = crud_eco.create_eco(db, data, current_user.id)
    return _build_eco_detail(db, eco)


# ─────────────────────────────────────────────────────
# 3. ECO 详情
# ─────────────────────────────────────────────────────
@router.get("/{eco_id}")
async def get_eco(
    eco_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    return _build_eco_detail(db, eco)


# ─────────────────────────────────────────────────────
# 4. 更新 ECO
# ─────────────────────────────────────────────────────
@router.put("/{eco_id}")
async def update_eco(
    eco_id: uuid.UUID, data: schemas_eco.ECOEdit,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    crud_eco.update_eco(db, eco, data)
    return _build_eco_detail(db, eco)


# ─────────────────────────────────────────────────────
# 5. 删除 ECO
# ─────────────────────────────────────────────────────
@router.delete("/{eco_id}")
async def delete_eco(
    eco_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    if eco.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态的 ECO 可以删除")
    crud_eco.delete_eco(db, eco)
    return {"detail": "已删除"}


# ─────────────────────────────────────────────────────
# 6. 提交评审
# ─────────────────────────────────────────────────────
@router.post("/{eco_id}/submit")
async def submit_eco(
    eco_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    if eco.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可提交评审")
    crud_eco.clear_review_records(db, eco_id)

    # 无审批人时自动批准
    if not eco.reviewers or len(eco.reviewers) == 0:
        eco = crud_eco.change_eco_status(db, eco_id, "approved", current_user.id, "无审批人，自动批准")
    else:
        eco = crud_eco.change_eco_status(db, eco_id, "reviewing", current_user.id, "提交评审")
    return _build_eco_detail(db, eco)


# ─────────────────────────────────────────────────────
# 7. 撤回评审
# ─────────────────────────────────────────────────────
@router.post("/{eco_id}/withdraw")
async def withdraw_eco(
    eco_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    if eco.status != "reviewing":
        raise HTTPException(status_code=400, detail="仅评审中状态可撤回")
    if current_user.role != "admin" and eco.creator_id != current_user.id:
        raise HTTPException(status_code=403, detail="仅创建人或管理员可撤回")
    crud_eco.clear_review_records(db, eco_id)
    eco = crud_eco.change_eco_status(db, eco_id, "draft", current_user.id, "撤回评审")
    return _build_eco_detail(db, eco)


# ─────────────────────────────────────────────────────
# 8. 审批操作
# ─────────────────────────────────────────────────────
@router.post("/{eco_id}/review")
async def review_eco(
    eco_id: uuid.UUID,
    data: schemas_eco.ECOReviewAction,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    if eco.status != "reviewing":
        raise HTTPException(status_code=400, detail="ECO 不在评审中状态")

    uid_str = str(current_user.id)
    is_admin = current_user.role == "admin"
    is_reviewer = any(r.get("user_id") == uid_str for r in (eco.reviewers or []))
    if not is_admin and not is_reviewer:
        raise HTTPException(status_code=403, detail="您不是该 ECO 的指定审批人")

    if data.decision == "returned":
        crud_eco.clear_review_records(db, eco_id)
        eco = crud_eco.change_eco_status(db, eco_id, "draft", current_user.id, data.comment or "退回修改")
        return _build_eco_detail(db, eco)

    crud_eco.add_eco_review_record(db, eco_id, current_user.id, data.decision, data.comment)

    decision_labels = {"approved": "审批通过", "rejected": "审批驳回"}
    if data.decision in decision_labels:
        log = ECOStatusLog(
            eco_id=eco_id, from_status=eco.status, to_status=eco.status,
            operator_id=current_user.id, operator_name=current_user.real_name,
            comment=f"{decision_labels[data.decision]}" + (f": {data.comment}" if data.comment else ""),
        )
        db.add(log)
        db.commit()

    if data.decision == "approved":
        if crud_eco.check_all_approved(db, eco_id):
            crud_eco.change_eco_status(db, eco_id, "approved", current_user.id, "所有审批人已通过", skip_log=True)
    elif data.decision == "rejected":
        crud_eco.change_eco_status(db, eco_id, "rejected", current_user.id, data.comment or "驳回")

    db.refresh(eco)
    return _build_eco_detail(db, eco)


# ─────────────────────────────────────────────────────
# 10. 开始执行（approved → executing）
# ─────────────────────────────────────────────────────
@router.post("/{eco_id}/execute")
async def start_execution(
    eco_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    if eco.status != "approved":
        raise HTTPException(status_code=400, detail="仅已批准状态可执行")
    eco = crud_eco.change_eco_status(db, eco_id, "executing", current_user.id, "开始执行")
    return _build_eco_detail(db, eco)


# ─────────────────────────────────────────────────────
# 11. 执行单项
# ─────────────────────────────────────────────────────
@router.post("/{eco_id}/execute-item/{item_id}")
async def execute_single_item(
    eco_id: uuid.UUID, item_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    if eco.status not in ("executing", "approved"):
        raise HTTPException(status_code=400, detail="仅已批准或执行中状态可执行")
    if eco.status == "approved":
        crud_eco.change_eco_status(db, eco_id, "executing", current_user.id, "开始执行")
    item = crud_eco.get_execution_item(db, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="执行项不存在")
    crud_eco.execute_item(db, item)
    return _build_eco_detail(db, crud_eco.get_eco(db, eco_id))


# ─────────────────────────────────────────────────────
# 12. 一键执行全部
# ─────────────────────────────────────────────────────
@router.post("/{eco_id}/execute-all")
async def execute_all_items(
    eco_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    if eco.status not in ("approved", "executing"):
        raise HTTPException(status_code=400, detail="仅已批准或执行中状态可一键执行")
    if eco.status == "approved":
        crud_eco.change_eco_status(db, eco_id, "executing", current_user.id, "开始一键执行")
    results = crud_eco.execute_all(db, eco)
    return {"results": results, "eco": _build_eco_detail(db, crud_eco.get_eco(db, eco_id))}


# ─────────────────────────────────────────────────────
# 12b. 完成执行（executing → completed）
# ─────────────────────────────────────────────────────
@router.post("/{eco_id}/complete")
async def complete_execution(
    eco_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    if eco.status != "executing":
        raise HTTPException(status_code=400, detail="仅执行中状态可完成执行")
    eco = crud_eco.change_eco_status(db, eco_id, "completed", current_user.id, "手动完成执行")
    return _build_eco_detail(db, eco)


# ─────────────────────────────────────────────────────
# 13. 执行项列表
# ─────────────────────────────────────────────────────
@router.get("/{eco_id}/execution-items")
async def list_execution_items(
    eco_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
):
    items = crud_eco.get_execution_items(db, eco_id)
    serialized = []
    for ei in items:
        serialized.append({
            "id": str(ei.id), "source": ei.source, "entity_type": ei.entity_type,
            "entity_id": str(ei.entity_id) if ei.entity_id else None,
            "entity_code": ei.entity_code or "", "entity_name": ei.entity_name,
            "action": ei.action, "status": ei.status, "detail": ei.detail or {},
            "new_entity_id": str(ei.new_entity_id) if ei.new_entity_id else None,
            "new_version": ei.new_version,
            "parent_entity_id": str(ei.parent_entity_id) if ei.parent_entity_id else None,
            "parent_new_entity_id": str(ei.parent_new_entity_id) if ei.parent_new_entity_id else None,
            "error_message": ei.error_message, "sort_order": ei.sort_order,
            "executed_at": ei.executed_at,
        })
    return {"items": serialized}


# ─────────────────────────────────────────────────────
# 14. 添加执行项
# ─────────────────────────────────────────────────────
@router.post("/{eco_id}/execution-items")
async def add_execution_item(
    eco_id: uuid.UUID, data: schemas_eco.ECOExecutionItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    if eco.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可添加执行项")
    item = crud_eco.add_execution_item(db, eco, data)
    return {
        "id": str(item.id), "source": item.source, "entity_type": item.entity_type,
        "entity_name": item.entity_name, "action": item.action, "status": item.status,
        "sort_order": item.sort_order,
    }


# ─────────────────────────────────────────────────────
# 15. 编辑执行项
# ─────────────────────────────────────────────────────
@router.put("/{eco_id}/execution-items/{item_id}")
async def edit_execution_item(
    eco_id: uuid.UUID, item_id: uuid.UUID,
    data: schemas_eco.ECOExecutionItemEdit,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    if eco.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可编辑执行项")
    exec_item = db.query(ECOExecutionItem).filter(
        ECOExecutionItem.id == item_id, ECOExecutionItem.eco_id == eco_id
    ).first()
    if not exec_item:
        raise HTTPException(status_code=404, detail="执行项不存在")
    item = crud_eco.update_execution_item(db, exec_item, data)
    return {
        "id": str(item.id), "entity_name": item.entity_name,
        "action": item.action, "status": item.status, "sort_order": item.sort_order,
    }


# ─────────────────────────────────────────────────────
# 16. 删除执行项
# ─────────────────────────────────────────────────────
@router.delete("/{eco_id}/execution-items/{item_id}")
async def remove_execution_item(
    eco_id: uuid.UUID, item_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    if eco.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可删除执行项")
    crud_eco.remove_execution_item(db, eco_id, item_id)
    return {"detail": "已删除"}


# ─────────────────────────────────────────────────────
# 16b. 手动升版（克隆实体创建新版本）
# ─────────────────────────────────────────────────────
@router.post("/{eco_id}/execution-items/{item_id}/upgrade")
async def manual_upgrade_item(
    eco_id: uuid.UUID, item_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    item = crud_eco.get_execution_item(db, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="执行项不存在")
    if item.entity_type not in ("part", "assembly"):
        raise HTTPException(status_code=400, detail="仅零件/部件支持升版")
    if not item.entity_id:
        raise HTTPException(status_code=400, detail="执行项缺少 entity_id")

    model = Part if item.entity_type == "part" else Assembly
    entity = db.query(model).filter(model.id == item.entity_id).first()
    if not entity:
        raise HTTPException(status_code=404, detail="实体不存在")

    new_id, new_version = crud_eco._clone_entity(db, entity, item.entity_type)
    item.new_entity_id = new_id
    item.new_version = new_version
    item.detail = {**(item.detail or {}), "new_entity_id": str(new_id), "new_version": new_version}
    db.commit()
    return {"new_entity_id": str(new_id), "new_version": new_version}


# ─────────────────────────────────────────────────────
# 16c. 还原（根据新版本实体状态决定行为）
# ─────────────────────────────────────────────────────
@router.post("/{eco_id}/execution-items/{item_id}/revert")
async def manual_revert_item(
    eco_id: uuid.UUID, item_id: uuid.UUID,
    body: schemas_eco.ECOExecutionItemAction = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    item = crud_eco.get_execution_item(db, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="执行项不存在")

    # 优先使用 DB 记录的 new_entity_id，其次使用请求中的（自动检测场景）
    target_entity_id = item.new_entity_id or (uuid.UUID(body.new_entity_id) if body and body.new_entity_id else None)
    if not target_entity_id:
        raise HTTPException(status_code=400, detail="尚未执行升版，无需还原")

    model = Part if item.entity_type == "part" else Assembly
    new_entity = db.query(model).filter(model.id == target_entity_id).first()

    if not new_entity:
        # 实体已被删除，清理记录
        item.new_entity_id = None
        item.new_version = None
        item.detail = {**(item.detail or {}), "new_entity_id": "", "new_version": ""}
        db.commit()
        return {"detail": "已还原"}

    if new_entity.status == "released":
        raise HTTPException(status_code=400, detail="已发布的零部件不可还原")

    if new_entity.status == "draft":
        # 已升版状态：删除新版本实体（完全撤销）
        from app.models import BOMItem
        # 检查原始实体是否有父项引用（草稿阶段 BOM 尚未更新指向新版本）
        from app.models import BOMItem
        parent_filters = [BOMItem.child_id == target_entity_id]
        if item.entity_id:
            parent_filters.append(BOMItem.child_id == item.entity_id)
        from sqlalchemy import or_
        parent_count = db.query(BOMItem).filter(or_(*parent_filters)).count()
        if parent_count > 0:
            raise HTTPException(status_code=400, detail="该零部件已被其他部件引用，无法删除")
        # 清理该实体自身的子项 BOM 关系
        db.query(BOMItem).filter(
            BOMItem.parent_id == target_entity_id
        ).delete()
        db.delete(new_entity)
        item.new_entity_id = None
        item.new_version = None
        item.detail = {**(item.detail or {}), "new_entity_id": "", "new_version": ""}
    else:
        # 已冻结状态：仅将状态改回 draft（保留实体）
        new_entity.status = "draft"

    db.commit()
    return {"detail": "已还原", "new_entity_status": new_entity.status if new_entity else None}


# ─────────────────────────────────────────────────────
# 16d. 冻结（将升版创建的新版本状态改为 frozen）
# ─────────────────────────────────────────────────────
@router.post("/{eco_id}/execution-items/{item_id}/freeze")
async def manual_freeze_item(
    eco_id: uuid.UUID, item_id: uuid.UUID,
    body: schemas_eco.ECOExecutionItemAction = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    item = crud_eco.get_execution_item(db, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="执行项不存在")

    # 优先使用 DB 记录的 new_entity_id，其次使用请求中的（自动检测场景）
    target_entity_id = item.new_entity_id or (uuid.UUID(body.new_entity_id) if body and body.new_entity_id else None)
    if not target_entity_id:
        raise HTTPException(status_code=400, detail="尚未执行升版，无法冻结")

    model = Part if item.entity_type == "part" else Assembly
    new_entity = db.query(model).filter(model.id == target_entity_id).first()
    if not new_entity:
        raise HTTPException(status_code=404, detail="新版本实体不存在")

    new_entity.status = "frozen"
    # 同步更新执行项记录
    if not item.new_entity_id and target_entity_id:
        item.new_entity_id = target_entity_id
    db.commit()
    return {"detail": "已冻结", "new_entity_status": "frozen"}


# ─────────────────────────────────────────────────────
# 16e. 发布（将升版创建的新版本状态改为 released）
# ─────────────────────────────────────────────────────
@router.post("/{eco_id}/execution-items/{item_id}/release")
async def manual_release_item(
    eco_id: uuid.UUID, item_id: uuid.UUID,
    body: schemas_eco.ECOExecutionItemAction = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    item = crud_eco.get_execution_item(db, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="执行项不存在")

    # 优先使用 DB 记录的 new_entity_id，其次使用请求中的（自动检测场景）
    target_entity_id = item.new_entity_id or (uuid.UUID(body.new_entity_id) if body and body.new_entity_id else None)
    if not target_entity_id:
        raise HTTPException(status_code=400, detail="尚未执行升版，无法发布")

    model = Part if item.entity_type == "part" else Assembly
    new_entity = db.query(model).filter(model.id == target_entity_id).first()
    if not new_entity:
        raise HTTPException(status_code=404, detail="新版本实体不存在")

    new_entity.status = "released"
    db.commit()
    return {"detail": "已发布", "new_entity_status": "released"}


# ─────────────────────────────────────────────────────
# 17. 状态变更日志
# ─────────────────────────────────────────────────────
@router.get("/{eco_id}/status-logs")
async def get_status_logs(
    eco_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
):
    logs = crud_eco.get_status_logs(db, eco_id)
    serialized = [
        {"id": str(l.id), "from_status": l.from_status, "to_status": l.to_status,
         "operator_name": l.operator_name or "", "comment": l.comment, "created_at": l.created_at}
        for l in logs
    ]
    return {"items": serialized}


# ─────────────────────────────────────────────────────
# 18. 知会用户
# ─────────────────────────────────────────────────────
@router.post("/{eco_id}/cc")
async def cc_users(
    eco_id: uuid.UUID, data: schemas_eco.ECOCcAction,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    crud_eco.add_cc_users(db, eco, data.user_ids)
    return {"detail": "已添加知会"}


# ─────────────────────────────────────────────────────
# 19. 取消知会
# ─────────────────────────────────────────────────────
@router.delete("/{eco_id}/cc/{user_id}")
async def uncc_user(
    eco_id: uuid.UUID, user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    eco = crud_eco.get_eco(db, eco_id)
    crud_eco.remove_cc_user(db, eco, str(user_id))
    return {"detail": "已取消知会"}


# ─────────────────────────────────────────────────────
# 20. BOM 溯源
# ─────────────────────────────────────────────────────
@router.post("/{eco_id}/bom-trace/{entity_type}/{entity_id}")
async def bom_trace(
    eco_id: uuid.UUID, entity_type: str, entity_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
):
    try:
        from app.crud_ecr import _get_upward_trace, _get_downward_trace
        upward = _get_upward_trace(db, entity_type, entity_id)
        downward = _get_downward_trace(db, entity_type, entity_id)
        return {"upward_chain": upward, "downward_items": downward}
    except Exception:
        return {"upward_chain": [], "downward_items": []}
