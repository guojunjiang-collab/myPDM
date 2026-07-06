from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
import csv
import io
from sqlalchemy.orm import Session
from typing import List
import uuid

from ..database import get_db
from ..models import User
from ..models_parts import PartMaster
from .. import crud, models, schemas
from ..bom import compare
from ..permissions import require_permission
from sqlalchemy import cast, String, text

router = APIRouter(prefix="/bom", tags=["BOM管理"])


@router.get("/references/{entity_type}/{entity_id}")
async def check_references(
    entity_type: str,
    entity_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:doc_refs")),
):
    """检查某个实体是否被引用（用于删除前校验）"""
    references = []

    # 1. 检查 BOM 子项引用（零件/部件作为子项被引用）
    if entity_type in ("component", "part", "assembly"):
        # 兼容 'assembly' 和 'component' 两种 child_type 值
        child_types = [entity_type]
        if entity_type == "assembly":
            child_types.append("component")
        bom_items = db.query(models.BOMItem).filter(
            models.BOMItem.child_type.in_(child_types),
            models.BOMItem.child_id == entity_id,
            models.BOMItem.deleted_at.is_(None),  # 排除已软删除的 BOM 关系
        ).all()
        for item in bom_items:
            if item.parent_type in ("part", "component", "assembly"):
                p = db.query(PartMaster).filter(PartMaster.id == item.parent_id).first()
                if p and p.deleted_at is None:
                    references.append({"type": "bom_child", "parent_id": str(item.parent_id), "label": f"零部件 {p.code}"})

    # 2. 检查 document_links 引用（图文档被关联到零部件）- 已迁移到 PartRevision.document_links
    if entity_type == "document":
        from ..models_parts import PartRevision
        doc_id_str = str(entity_id)
        for rev in db.query(PartRevision).all():
            for link in (rev.document_links or []):
                if link.get("document_id") == doc_id_str:
                    master = db.query(PartMaster).filter(PartMaster.id == rev.master_id).first()
                    label = f"零部件 {master.code}" if master else "零部件"
                    references.append({"type": "entity_document", "parent_id": str(rev.master_id), "label": label})
                    break

    return references

@router.get("/items/all")
async def get_all_bom_items_route(updated_since: float = None, db: Session = Depends(get_db), current_user: User = Depends(require_permission("bom:doc_refs"))):
    """获取所有 BOM 关系，用于前端反查"""
    include_deleted = bool(updated_since)
    items = crud.get_all_bom_items(db, include_deleted=include_deleted, updated_since=updated_since)
    # BOM items use `quantity` column, backend serializes it as `qty`
    result = []
    for item in items:
        result.append({
            "id": str(item.id),
            "parent_type": "part",
            "parent_id": str(item.parent_revision_id) if item.parent_revision_id else None,
            "child_type": "part",
            "child_id": str(item.child_revision_id) if item.child_revision_id else None,
            "quantity": item.quantity,
            "created_at": item.created_at.isoformat() if item.created_at else None,
            "updated_at": item.updated_at.isoformat() if hasattr(item, 'updated_at') and item.updated_at else None,
            "deleted_at": item.deleted_at.isoformat() if hasattr(item, 'deleted_at') and item.deleted_at else None,
        })
    return result


@router.get("/tree/{item_type}/{item_id}")
async def get_bom_tree(item_type: str, item_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("bom:tree"))):
    if item_type not in ["component", "part", "assembly"]:
        raise HTTPException(status_code=400, detail="无效的类型")
    items = crud.get_bom_items(db, item_type, item_id)
    result = []
    for item in items:
        child = db.query(PartMaster).filter(PartMaster.id == item.child_revision_id).first() if item.child_revision_id else None
        child_detail = None
        if child:
            child_detail = {"id": str(child.id), "code": child.code, "name": child.name, "spec": getattr(child, 'spec', ''), "type": "component"}
        result.append({
            "id": str(item.id),
            "child_type": "part",
            "child_id": str(item.child_revision_id) if item.child_revision_id else None,
            "quantity": int(item.quantity),
            "child_detail": child_detail
        })
    return result

@router.get("/trace/{entity_type}/{entity_id}", response_model=List[schemas.BOMTraceItem])
async def get_bom_trace(
    entity_type: str,
    entity_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:trace")),
):
    """递归反查：查找使用该零件/部件的所有父装配体（向上追溯最多10层）"""
    if entity_type not in ("component", "part", "assembly"):
        raise HTTPException(status_code=400, detail="无效的类型，仅支持 part 或 assembly")

    # 递归 CTE：向上追溯父级（忽略软删除的 BOM 关系）
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

    result = []
    for row in rows:
        parent_entity = None
        if row.parent_type in ("assembly", "component"):
            a = db.query(PartMaster).filter(PartMaster.id == row.parent_id).first()
            if a:
                parent_entity = {
                    "id": str(a.id), "code": a.code, "name": a.name,
                    "spec": getattr(a, 'spec', ''), "version": "", "status": "",
                }
        elif row.parent_type == "part":
            p = crud.get_part(db, row.parent_id)
            if p:
                parent_entity = {
                    "id": str(p.id), "code": p.code, "name": p.name,
                    "spec": p.spec, "version": p.version, "status": p.status,
                }

        child_type = "component"
        c = db.query(PartMaster).filter(PartMaster.id == row.child_id).first()
        child_entity = None
        if c:
            child_entity = {"id": str(c.id), "code": c.code, "name": c.name, "type": "component"}

        result.append({
            "level": row.level,
            "bom_item_id": str(row.id),
            "parent_assembly": parent_entity if row.parent_type in ("assembly", "component") else None,
            "parent_part": parent_entity if row.parent_type == "part" else None,
            "child_entity": child_entity,
            "quantity": int(row.quantity) if row.quantity else 1,
        })

    return result


@router.post("/items", response_model=schemas.BOMItemResponse)
async def create_bom_item(item: schemas.BOMItemCreate, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("bom:create_relation"))):
    db_item = crud.create_bom_item(db, item)
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "添加BOM项", "bom", str(db_item.id), None, ip)
    return db_item

@router.delete("/items/{item_id}")
async def delete_bom_item(item_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("bom:delete_relation"))):
    if not crud.delete_bom_item(db, item_id):
        raise HTTPException(status_code=404, detail="BOM项不存在")
    ip = request.client.host if request.client else None
    crud.create_log(db, current_user.id, current_user.username, "删除BOM项", "bom", str(item_id), None, ip)
    return {"message": "BOM项已删除"}

@router.post("/compare")
async def compare_bom_assemblies(
    request: schemas.BOMCompareRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:compare"))
):
    """对比两个装配体的BOM结构"""
    try:
        result = compare.compare_assemblies(
            db,
            request.left_assembly_id,
            request.right_assembly_id,
            options=request.options.model_dump()
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"对比失败: {str(e)}")

@router.post("/compare/component")
async def compare_bom_components(
    request: schemas.BOMCompareRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:compare"))
):
    """对比两个子部件（装配体）的BOM结构"""
    try:
        result = compare.compare_assemblies(
            db,
            request.left_assembly_id,
            request.right_assembly_id,
            options=request.options.model_dump()
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"子部件对比失败: {str(e)}")


@router.get("/export/{item_type}/{item_id}")
async def export_bom_csv(
    item_type: str,
    item_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("bom:export")),
):
    """导出零件/部件 BOM 为 CSV（供 AI 助手与前端下载）。"""
    if item_type not in ("component", "part", "assembly"):
        raise HTTPException(status_code=400, detail="无效的类型")
    nodes = compare.get_bom_tree_recursive(db, item_id) if item_type == "assembly" else []
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["层级", "类型", "编码", "名称", "规格", "数量"])
    for n in nodes:
        writer.writerow([n.get("level"), n.get("child_type"), n.get("child_code"),
                         n.get("child_name"), n.get("child_spec"), n.get("quantity")])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="bom_{item_id}.csv"'})
