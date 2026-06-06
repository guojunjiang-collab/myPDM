"""
ECR (Engineering Change Request) - API Router
==============================================
变更管理 - ECR 模块 API 端点
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import User, Part, Assembly, BOMItem
from app.models_ecr import ECR as ECRModel, ECRReviewRecord, ECRStatusLog, ECRAffectedItem
from app import crud_ecr, schemas_ecr
from app.routers.auth import require_role

router = APIRouter(prefix="/ecrs", tags=["变更管理"])


# ─────────────────────────────────────────────────────
# 辅助函数：构建 ECR 详情响应
# ─────────────────────────────────────────────────────
def _build_ecr_detail(db: Session, ecr: ECRModel) -> dict:
    """将 ECR 模型转为详情 dict"""
    # 创建人姓名
    creator = db.query(User).filter(User.id == ecr.creator_id).first()
    creator_name = creator.real_name if creator else ""

    # 审批人数量
    reviewers_count = len(ecr.reviewers) if ecr.reviewers else 0
    approved_count = db.query(ECRReviewRecord).filter(
        ECRReviewRecord.ecr_id == ecr.id,
        ECRReviewRecord.decision == "approved"
    ).count()
    affected_count = db.query(ECRAffectedItem).filter(
        ECRAffectedItem.ecr_id == ecr.id
    ).count()

    # 审批人详情列表
    reviewers_detail = []
    for r in (ecr.reviewers or []):
        reviewers_detail.append({
            "seq": r.get("seq", 0),
            "user_id": r.get("user_id", ""),
            "user_name": r.get("user_name", ""),
            "role": r.get("role", ""),
        })

    # 审批记录
    review_records = db.query(ECRReviewRecord).filter(
        ECRReviewRecord.ecr_id == ecr.id
    ).order_by(ECRReviewRecord.created_at).all()
    review_record_items = [
        {
            "id": str(r.id),
            "reviewer_id": str(r.reviewer_id),
            "reviewer_name": r.reviewer_name or "",
            "decision": r.decision,
            "comment": r.comment,
            "created_at": r.created_at,
        }
        for r in review_records
    ]

    # 状态日志
    status_logs = db.query(ECRStatusLog).filter(
        ECRStatusLog.ecr_id == ecr.id
    ).order_by(ECRStatusLog.created_at).all()
    status_log_items = [
        {
            "id": str(log.id),
            "from_status": log.from_status,
            "to_status": log.to_status,
            "operator_name": log.operator_name or "",
            "comment": log.comment,
            "created_at": log.created_at,
        }
        for log in status_logs
    ]

    # 受影响对象
    affected_items_data = crud_ecr.get_affected_items(db, ecr.id)
    affected_item_list = [
        {
            "id": str(item.id),
            "entity_type": item.entity_type,
            "entity_id": str(item.entity_id),
            "entity_code": item.entity_code or "",
            "entity_name": item.entity_name or "",
            "entity_version": item.entity_version or "",
            "change_description": item.change_description,
            "change_type": item.change_type,
            "bom_impact": item.bom_impact or {},
        }
        for item in affected_items_data
    ]

    return {
        "id": ecr.id,
        "ecr_number": ecr.ecr_number,
        "title": ecr.title,
        "status": ecr.status,
        "priority": ecr.priority,
        "category": ecr.category,
        "creator_name": creator_name,
        "reviewers_count": reviewers_count,
        "approved_count": approved_count,
        "affected_count": affected_count,
        "created_at": ecr.created_at,
        "updated_at": ecr.updated_at,
        # 详情扩展
        "description": ecr.description,
        "reason": ecr.reason,
        "review_mode": ecr.review_mode,
        "reviewers": reviewers_detail,
        "review_records": review_record_items,
        "document_links": ecr.document_links or [],
        "cc_users": ecr.cc_users or [],
        "affected_items": affected_item_list,
        "status_logs": status_log_items,
        "reviewed_at": ecr.reviewed_at,
        "closed_at": ecr.closed_at,
        "eco_id": str(ecr.eco_id) if ecr.eco_id else None,
    }


# ─────────────────────────────────────────────────────
# 1. ECR 列表
# ─────────────────────────────────────────────────────
@router.get("/")
async def list_ecrs(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query(None),
    status: str = Query(None),
    priority: str = Query(None),
    updated_since: float = Query(None, description="仅返回指定 UNIX 时间戳之后更新的记录（含已删除）"),
    brief: bool = Query(False, description="仅返回简要字段：ecr_number, title, status, priority, creator_name, updated_at, deleted_at"),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
):
  """获取 ECR 列表（分页 + 筛选）。非管理员用户看不到他人创建的草稿 ECR"""
  params = schemas_ecr.ECRListParams(
      page=page, page_size=page_size,
      search=search, status=status, priority=priority
  )
  include_deleted = bool(updated_since)
  items, total = crud_ecr.get_ecrs(db, params, current_user, include_deleted=include_deleted, updated_since=updated_since)

  if brief:
      brief_items = [
          {
              "id": str(item["id"]),
              "ecr_number": item["ecr_number"],
              "title": item["title"],
              "status": item["status"],
              "priority": item["priority"],
              "creator_name": item["creator_name"],
              "updated_at": item["updated_at"],
              "deleted_at": item.get("deleted_at"),
          }
          for item in items
      ]
      return {"items": brief_items, "total": total, "page": page, "page_size": page_size}

  # 将 UUID 转为字符串
  items_serialized = []
  for item in items:
      serialized = {**item}
      serialized["id"] = str(serialized["id"])
      serialized["creator_id"] = str(serialized["creator_id"]) if serialized.get("creator_id") else None
      items_serialized.append(serialized)
  return {
      "items": items_serialized,
      "total": total,
      "page": page,
      "page_size": page_size,
  }


# ─────────────────────────────────────────────────────
# 2. 创建 ECR
# ─────────────────────────────────────────────────────
@router.post("/")
async def create_ecr(
    data: schemas_ecr.ECRCreate,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    """创建 ECR"""
    ecr = crud_ecr.create_ecr(db, data, current_user.id)
    return _build_ecr_detail(db, ecr)


# ─────────────────────────────────────────────────────
# 3. ECR 详情
# ─────────────────────────────────────────────────────
@router.get("/{ecr_id}")
async def get_ecr(
    ecr_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
):
    """获取 ECR 详情"""
    ecr = crud_ecr.get_ecr(db, ecr_id)
    return _build_ecr_detail(db, ecr)


# ─────────────────────────────────────────────────────
# 4. 更新 ECR（仅 draft）
# ─────────────────────────────────────────────────────
@router.put("/{ecr_id}")
async def update_ecr(
    ecr_id: uuid.UUID,
    data: schemas_ecr.ECREdit,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    """更新 ECR（仅草稿状态）"""
    ecr = crud_ecr.update_ecr(db, ecr_id, data)
    return _build_ecr_detail(db, ecr)


# ─────────────────────────────────────────────────────
# 5. 删除 ECR（仅 draft）
# ─────────────────────────────────────────────────────
@router.delete("/{ecr_id}")
async def delete_ecr(
    ecr_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    """删除 ECR（仅草稿状态）"""
    crud_ecr.delete_ecr(db, ecr_id)
    return {"message": "ECR 已删除"}


# ─────────────────────────────────────────────────────
# 6. 提交评审（draft → reviewing）
# ─────────────────────────────────────────────────────
@router.post("/{ecr_id}/submit")
async def submit_ecr(
    ecr_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    """提交评审"""
    ecr = crud_ecr.get_ecr(db, ecr_id)
    if ecr.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态的 ECR 可以提交评审")

    # 检查是否有审批人
    if not ecr.reviewers or len(ecr.reviewers) == 0:
        raise HTTPException(status_code=400, detail="请设置至少一位审批人")

    ecr = crud_ecr.change_ecr_status(
        db, ecr_id, "reviewing", current_user.id, "提交评审"
    )
    return crud_ecr.get_ecr(db, ecr_id)


# ─────────────────────────────────────────────────────
# 6.5 撤回评审（reviewing → draft，仅创建人）
# ─────────────────────────────────────────────────────
@router.post("/{ecr_id}/withdraw")
async def withdraw_ecr(
    ecr_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
  """撤回评审，将 ECR 从评审中退回到草稿状态"""
  ecr = crud_ecr.get_ecr(db, ecr_id)
  if ecr.status != "reviewing":
      raise HTTPException(status_code=400, detail="仅评审中状态的 ECR 可以撤回")
  # 仅创建人或 admin 可撤回
  if ecr.creator_id != current_user.id and current_user.role != "admin":
      raise HTTPException(status_code=403, detail="仅创建人或管理员可以撤回")
  # 撤回时清空旧审批记录
  db.query(ECRReviewRecord).filter(
      ECRReviewRecord.ecr_id == ecr_id
  ).delete()
  ecr = crud_ecr.change_ecr_status(
      db, ecr_id, "draft", current_user.id, "撤回评审"
  )
  return _build_ecr_detail(db, ecr)


# ─────────────────────────────────────────────────────
# 7. 审批操作（reviewing → approved/rejected/draft）
# ─────────────────────────────────────────────────────
@router.post("/{ecr_id}/review")
async def review_ecr(
    ecr_id: uuid.UUID,
    data: schemas_ecr.ECRReviewAction,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
  """审批操作（通过/驳回/退回）"""
  ecr = crud_ecr.get_ecr(db, ecr_id)
  if ecr.status != "reviewing":
      raise HTTPException(status_code=400, detail="仅评审中状态的 ECR 可进行审批")

  # 检查当前用户是否为审批人（admin 可越权审批）
  reviewer_ids = set()
  for r in (ecr.reviewers or []):
      try:
          reviewer_ids.add(uuid.UUID(r["user_id"]))
      except (ValueError, KeyError):
          pass
  if current_user.role != "admin" and current_user.id not in reviewer_ids:
      raise HTTPException(status_code=403, detail="您不是该 ECR 的指定审批人")

  # 退回/驳回时，先清除旧的审批记录，再创建新记录，最后流转状态
  if data.decision == "returned":
      db.query(ECRReviewRecord).filter(
          ECRReviewRecord.ecr_id == ecr_id
      ).delete()
      # 退回不创建审批记录，直接流转状态（保留状态日志）
      crud_ecr.change_ecr_status(
          db, ecr_id, "draft", current_user.id,
          comment=data.comment or "退回修改"
      )
      db.refresh(ecr)
      return _build_ecr_detail(db, ecr)

  # 保存审批记录（通过/驳回）
  crud_ecr.add_ecr_review_record(
      db, ecr_id, current_user.id, data.decision, data.comment
  )

  # 记录审批操作到状态日志
  decision_labels = {"approved": "审批通过", "rejected": "审批驳回"}
  if data.decision in decision_labels:
      log = ECRStatusLog(
          ecr_id=ecr_id,
          from_status=ecr.status,
          to_status=ecr.status,  # 个人审批不改变状态
          operator_id=current_user.id,
          operator_name=current_user.real_name,
          comment=f"{decision_labels[data.decision]}" + (f": {data.comment}" if data.comment else ""),
      )
      db.add(log)
      db.commit()

  # 根据审批决定触发状态流转
  if data.decision == "approved":
      # 检查是否所有审批人都通过了
      if crud_ecr.check_all_approved(db, ecr_id):
          crud_ecr.change_ecr_status(
              db, ecr_id, "approved", current_user.id,
              comment="所有审批人已通过，自动批准"
          )
  elif data.decision == "rejected":
      crud_ecr.change_ecr_status(
          db, ecr_id, "rejected", current_user.id,
          comment=data.comment or "审批驳回"
      )

  db.refresh(ecr)
  return _build_ecr_detail(db, ecr)


# ─────────────────────────────────────────────────────
# 8. 关闭 ECR
# ─────────────────────────────────────────────────────
@router.post("/{ecr_id}/close")
async def close_ecr(
    ecr_id: uuid.UUID,
    data: schemas_ecr.ECRCloseAction = schemas_ecr.ECRCloseAction(),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    """关闭 ECR"""
    ecr = crud_ecr.get_ecr(db, ecr_id)
    if ecr.status not in ("approved", "rejected", "draft"):
        raise HTTPException(status_code=400, detail="当前状态不允许关闭")

    ecr = crud_ecr.change_ecr_status(
        db, ecr_id, "closed", current_user.id,
        comment=data.comment or "关闭"
    )
    return _build_ecr_detail(db, ecr)


# ─────────────────────────────────────────────────────
# 9. 添加受影响对象
# ─────────────────────────────────────────────────────
@router.post("/{ecr_id}/affected-items")
async def add_affected_item(
    ecr_id: uuid.UUID,
    data: schemas_ecr.AffectedItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    """添加受影响对象"""
    item = crud_ecr.add_affected_item(db, ecr_id, data)
    return {
        "id": str(item.id),
        "entity_type": item.entity_type,
        "entity_id": str(item.entity_id),
        "entity_code": item.entity_code or "",
        "entity_name": item.entity_name or "",
        "entity_version": item.entity_version or "",
        "change_description": item.change_description,
        "change_type": item.change_type,
        "bom_impact": item.bom_impact or {},
    }


# ─────────────────────────────────────────────────────
# 10. 删除受影响对象
# ─────────────────────────────────────────────────────
@router.delete("/{ecr_id}/affected-items/{item_id}")
async def remove_affected_item(
    ecr_id: uuid.UUID,
    item_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    """移除受影响对象"""
    crud_ecr.delete_affected_item(db, item_id)
    return {"message": "受影响对象已移除"}


@router.put("/{ecr_id}/affected-items/{item_id}")
async def update_affected_item(
    ecr_id: uuid.UUID,
    item_id: uuid.UUID,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    """更新受影响对象（含 BOM 影响评估结果）"""
    item = db.query(ECRAffectedItem).filter(
        ECRAffectedItem.id == item_id,
        ECRAffectedItem.ecr_id == ecr_id
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="受影响对象不存在")
    if data.get("bom_impact"):
        item.bom_impact = data["bom_impact"]
    if data.get("change_description") is not None:
        item.change_description = data["change_description"]
    if data.get("change_type"):
        item.change_type = data["change_type"]
    db.commit()
    return {"message": "已更新", "id": str(item.id)}


# ─────────────────────────────────────────────────────
# 11. 状态变更日志
# ─────────────────────────────────────────────────────
@router.get("/{ecr_id}/status-logs")
async def get_status_logs(
    ecr_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
):
    """获取状态变更日志"""
    logs = db.query(ECRStatusLog).filter(
        ECRStatusLog.ecr_id == ecr_id
    ).order_by(ECRStatusLog.created_at).all()
    return [
        {
            "id": str(log.id),
            "from_status": log.from_status,
            "to_status": log.to_status,
            "operator_name": log.operator_name or "",
            "comment": log.comment,
            "created_at": log.created_at,
        }
        for log in logs
    ]


# ─────────────────────────────────────────────────────
# 12. BOM 双向溯源
# ─────────────────────────────────────────────────────
@router.post("/{ecr_id}/bom-trace/{entity_type}/{entity_id}")
async def get_bom_trace(
    ecr_id: uuid.UUID,
    entity_type: str,
    entity_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
):
    """BOM 双向溯源：向上追溯父级 + 部件时向下展开一级子项"""
    if entity_type not in ("part", "assembly"):
        raise HTTPException(status_code=400, detail="仅支持 part 或 assembly")

    upward_chain = []
    downward_items = []

    # ── 变更对象自身 ──
    if entity_type == "part":
        obj = db.query(Part).filter(Part.id == entity_id).first()
    else:
        obj = db.query(Assembly).filter(Assembly.id == entity_id).first()
    if not obj:
        raise HTTPException(status_code=404, detail="实体不存在")

    # ── 向上溯源（复用 BOM trace 递归 CTE，构建树结构） ──
    from sqlalchemy import text
    sql = text("""
    WITH RECURSIVE trace AS (
      SELECT bi.id, bi.parent_type, bi.parent_id, bi.child_type, bi.child_id,
             bi.quantity, 1 AS level
      FROM bom_items bi
      WHERE bi.child_id = :entity_id
        AND bi.deleted_at IS NULL
        AND (bi.child_type = :entity_type
             OR (bi.child_type = 'component' AND :entity_type = 'assembly'))
      UNION ALL
      SELECT bi.id, bi.parent_type, bi.parent_id, bi.child_type, bi.child_id,
             bi.quantity, t.level + 1
      FROM bom_items bi
      JOIN trace t ON bi.child_id = t.parent_id
      WHERE t.level < 10
        AND bi.deleted_at IS NULL
    )
    SELECT * FROM trace ORDER BY level
    """)
    rows = db.execute(sql, {"entity_id": entity_id, "entity_type": entity_type}).fetchall()

    # 构建节点查找表：entity_id -> {code, name, version, entity_type}
    nodes_by_id = {}
    for row in rows:
        pk = str(row.parent_id)
        if pk not in nodes_by_id:
            if row.parent_type == "assembly":
                p = db.query(Assembly).filter(Assembly.id == row.parent_id).first()
            else:
                p = db.query(Part).filter(Part.id == row.parent_id).first()
            if p:
                nodes_by_id[pk] = {
                    "entity_type": row.parent_type,
                    "entity_code": p.code,
                    "entity_name": p.name,
                    "entity_version": p.version,
                }

    # 构建查询映射和边数据
    # 向上方向：从 child（下一层）查找其 parent（上一层）
    # child_to_parents: child_id -> [parent_id]  (一个下级可能有多个上级)
    # parent_meta:      parent_id -> {child_id, quantity}  边的数量
    child_to_parents = {}
    parent_meta = {}
    for row in rows:
        ck = str(row.child_id)
        pk = str(row.parent_id)
        # child -> parents
        if ck not in child_to_parents:
            child_to_parents[ck] = []
        if pk not in child_to_parents[ck]:
            child_to_parents[ck].append(pk)
        # parent meta: child & quantity (keep lowest-level = closest to target)
        if pk not in parent_meta or row.level < parent_meta[pk].get("_cte_level", 999):
            parent_meta[pk] = {"child_id": ck, "quantity": float(row.quantity), "_cte_level": row.level}

    # 变更对象自身（level 0，树根）
    target_id = str(entity_id)
    target_qty = 0
    if target_id in child_to_parents:
        first_parent = child_to_parents[target_id][0]
        target_qty = parent_meta.get(first_parent, {}).get("quantity", 1)

    upward_chain.append({
        "level": 0,
        "entity_type": entity_type,
        "entity_id": target_id,
        "entity_code": obj.code,
        "entity_name": obj.name,
        "entity_version": obj.version,
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

    # 从变更目标开始向上构建
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

    # ── 向下展开（仅部件） ──
    if entity_type == "assembly":
        child_rows = db.query(BOMItem).filter(
            BOMItem.parent_type == "assembly",
            BOMItem.parent_id == entity_id
        ).all()
        for child in child_rows:
            child_info = None
            child_code = None
            child_name = None
            child_version = None
            if child.child_type == "part" or child.child_type == "component":
                c = db.query(Part).filter(Part.id == child.child_id).first()
            else:
                c = db.query(Assembly).filter(Assembly.id == child.child_id).first()
            if c:
                child_code = c.code
                child_name = c.name
                child_version = c.version
            downward_items.append({
                "entity_type": "part" if child.child_type in ("part", "component") else "assembly",
                "entity_id": str(child.child_id),
                "entity_code": child_code,
                "entity_name": child_name or "",
                "entity_version": child_version,
                "quantity": float(child.quantity),
                "selected": False,
                "action": "no_change",
                "target_version": None,
                "quantity_change": None,
                "change_description": "",
                "parent_entity_id": str(entity_id),
                "parent_target_version": None,
            })

    return {
        "upward_chain": upward_chain,
        "downward_items": downward_items,
    }


# ─────────────────────────────────────────────────────
# 13. 知会用户
# ─────────────────────────────────────────────────────
@router.post("/{ecr_id}/cc")
async def cc_ecr(
    ecr_id: uuid.UUID,
    data: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
):
    """知会其他用户"""
    ecr = crud_ecr.get_ecr(db, ecr_id)
    user_ids = data.get("user_ids", [])
    if not user_ids:
        raise HTTPException(status_code=400, detail="请选择要知会的用户")
    
    cc_list = list(ecr.cc_users or [])
    existing = {c["user_id"] for c in cc_list}
    for uid in user_ids:
        if uid not in existing:
            user = db.query(User).filter(User.id == uid).first()
            if user:
                cc_list.append({"user_id": str(user.id), "user_name": user.real_name})
    
    ecr.cc_users = cc_list
    db.commit()
    return {"message": "知会成功", "cc_users": cc_list}


@router.delete("/{ecr_id}/cc/{user_id}")
async def uncc_ecr(
    ecr_id: uuid.UUID,
    user_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
):
    """取消知会"""
    ecr = crud_ecr.get_ecr(db, ecr_id)
    cc_list = list(ecr.cc_users or [])
    uid = str(user_id)
    ecr.cc_users = [c for c in cc_list if c["user_id"] != uid]
    db.commit()
    return {"message": "取消知会成功", "cc_users": ecr.cc_users}
