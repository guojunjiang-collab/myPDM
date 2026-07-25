"""
构型配置 - API Router
========================
构型项三层模型 CRUD + 签入签出 + 关联零部件 + 子构型项 + 构型方案
"""

import uuid
from uuid import UUID
from typing import Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from app.database import get_db
from app.models import DocumentRevision, DocumentMaster, DocumentIteration, DocumentAttachment, User as UModel
from app.models_parts import PartMaster, PartRevision, PartIteration, PartAttachment
from app import models_configuration as models
from app import schemas_configuration as schemas
from app import schemas as core_schemas
from app import crud_configuration as crud
from app import crud as core_crud
from app.models_parts import PartIteration, PartAttachment
from app.stp_converter import is_stp_file, get_lod_glb_paths, get_glb_cache_path
from app.media_token import mint_media_token
import os as _os
import logging
_logger = logging.getLogger(__name__)
from ..permissions import require_permission

router = APIRouter(prefix="/configurations", tags=["构型配置"])


def _resolve_creator(db: Session, creator_id):
    if not creator_id:
        return ""
    u = db.query(UModel).filter(UModel.id == creator_id).first()
    return u.real_name if u else ""


def _resolve_user_name(db: Session, user_id) -> Optional[str]:
    if not user_id:
        return None
    u = db.query(UModel).filter(UModel.id == user_id).first()
    return u.real_name if u else None


def _get_current_iteration(db: Session, revision_id: UUID) -> Optional[models.ConfigurationItemIteration]:
    """获取版本的最新迭代"""
    return crud._get_current_iteration(db, revision_id)


# ════════════════════════════════════════════════════════
# 构型项 CRUD（三层模型）
# ════════════════════════════════════════════════════════

@router.get("/items", response_model=dict)
async def list_config_items(
    page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=10000),
    search: str = Query(None),
    exclude_ancestors_of: str = Query(None),
    updated_since: float = Query(None),
    brief: bool = Query(False),
    top_level: bool = Query(False),
    status: str = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:read")),
):
    """构型项列表（按 master 聚合，返回最新 revision 摘要）"""
    skip = (page - 1) * page_size
    exclude_ids: set[str] = set()
    if exclude_ancestors_of:
        exclude_ids.add(exclude_ancestors_of)
        # BFS向上查找所有祖先master（防止循环引用）
        # exclude_ancestors_of 是 master_id，需找出其 revision 被引用为 child 的所有 parent master
        revs_of_target = crud.list_revisions_by_master(db, UUID(exclude_ancestors_of))
        child_rev_ids = [r.id for r in revs_of_target]
        if child_rev_ids:
            child_links = db.query(models.ConfigurationItemChild).filter(
                models.ConfigurationItemChild.child_revision_id.in_(child_rev_ids)
            ).all()
            parent_iteration_ids = set(l.parent_iteration_id for l in child_links)
            parent_rev_ids = set()
            if parent_iteration_ids:
                parent_iters = db.query(models.ConfigurationItemIteration).filter(
                    models.ConfigurationItemIteration.id.in_(parent_iteration_ids)
                ).all()
                parent_rev_ids = set(it.revision_id for it in parent_iters)
            if parent_rev_ids:
                parent_masters = db.query(models.ConfigurationItemRevision).filter(
                    models.ConfigurationItemRevision.id.in_(parent_rev_ids),
                    models.ConfigurationItemRevision.deleted_at.is_(None),
                ).all()
                for pm in parent_masters:
                    mid = str(pm.master_id)
                    if mid not in exclude_ids:
                        exclude_ids.add(mid)
                        # BFS 继续向上
                        more_exclude_ids: set[str] = set()
                        queue = [mid]
                        while queue:
                            current_mid = queue.pop(0)
                            current_revs = crud.list_revisions_by_master(db, UUID(current_mid))
                            c_rev_ids = [r.id for r in current_revs]
                            if not c_rev_ids:
                                continue
                            c_links = db.query(models.ConfigurationItemChild).filter(
                                models.ConfigurationItemChild.child_revision_id.in_(c_rev_ids)
                            ).all()
                            p_iter_ids = set(l.parent_iteration_id for l in c_links)
                            if not p_iter_ids:
                                continue
                            p_iters = db.query(models.ConfigurationItemIteration).filter(
                                models.ConfigurationItemIteration.id.in_(p_iter_ids)
                            ).all()
                            p_r_ids = set(it.revision_id for it in p_iters)
                            if not p_r_ids:
                                continue
                            p_masters = db.query(models.ConfigurationItemRevision).filter(
                                models.ConfigurationItemRevision.id.in_(p_r_ids),
                                models.ConfigurationItemRevision.deleted_at.is_(None),
                            ).all()
                            for pm in p_masters:
                                pmid = str(pm.master_id)
                                if pmid not in exclude_ids and pmid not in more_exclude_ids:
                                    more_exclude_ids.add(pmid)
                                    queue.append(pmid)
                        exclude_ids.update(more_exclude_ids)
    crud_kwargs = dict(search=search, skip=skip, limit=page_size, exclude_ids=exclude_ids, top_level=top_level, status=status)
    if updated_since is not None:
        crud_kwargs["include_deleted"] = True
        crud_kwargs["updated_since"] = updated_since
    items, total = crud.get_config_items(db, **crud_kwargs)

    if brief:
        return {
            "items": [{
                "id": i["revision_id"],
                "code": i["code"], "name": i["name"],
                "creator_id": str(i.get("creator_id")) if i.get("creator_id") else None,
                "updated_at": i.get("updated_at"),
                "deleted_at": None,
            } for i in items],
            "total": total, "page": page, "page_size": page_size,
        }
    return {
        "items": items,
        "total": total, "page": page, "page_size": page_size,
    }


@router.get("/items/{revision_id}", response_model=dict)
async def get_config_item_detail(
    revision_id: str, iteration_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:read")),
):
    """构型项详情：master + revision + iteration + parts + children + documents + versions
    可传入 iteration_id 查看历史迭代的子构型项数据（关联零部件始终取当前迭代）"""
    revision = crud.get_config_item_revision(db, UUID(revision_id))
    if not revision:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    # 子构型项可用指定迭代，关联零部件始终取当前迭代
    if iteration_id:
        child_iter = crud._get_iteration(db, UUID(iteration_id))
        if not child_iter or str(child_iter.revision_id) != revision_id:
            raise HTTPException(status_code=404, detail="迭代不存在或不属于该版本")
    else:
        child_iter = None
    _, current_iter = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    master = crud.get_config_item_master(db, revision.master_id)
    if not master:
        raise HTTPException(status_code=404, detail="构型项主数据不存在")

    checkout_user_name = _resolve_user_name(db, revision.check_out_user_id)

    # 关联零部件（始终取当前迭代）
    parts_data = []
    if current_iter:
        for p in crud.get_iteration_parts(db, current_iter.id):
            entity = db.query(PartMaster).filter(PartMaster.id == p.part_id).first()
            if entity:
                rev = None
                if p.revision_id:
                    rev = db.query(PartRevision).filter(PartRevision.id == p.revision_id).first()
                if rev is None:
                    rev = db.query(PartRevision).filter(
                        PartRevision.master_id == entity.id,
                        PartRevision.deleted_at.is_(None)
                    ).order_by(PartRevision.created_at.desc()).first()
                checkout_user_name = _resolve_user_name(db, rev.check_out_user_id) if rev else None
                # 检查当前迭代是否有STP生产附件（用于3D预览）
                has_3d = entity.type == 'assembly'
                if not has_3d and rev:
                    latest_iter = db.query(PartIteration).filter(
                        PartIteration.revision_id == rev.id,
                        PartIteration.iteration == rev.latest_iteration,
                    ).first()
                    if latest_iter:
                        has_3d = db.query(PartAttachment).filter(
                            PartAttachment.iteration_id == latest_iter.id,
                            PartAttachment.category == 'production',
                            PartAttachment.file_name.ilike('%.stp') | PartAttachment.file_name.ilike('%.step'),
                        ).limit(1).count() > 0
                parts_data.append({
                    "id": str(p.id), "iteration_id": str(p.iteration_id),
                    "part_type": p.part_type, "part_id": str(p.part_id),
                    "is_required": p.is_required, "quantity": p.quantity, "sort_order": p.sort_order,
                    "part_detail": {
                        "id": str(entity.id), "code": entity.code, "name": entity.name,
                        "version": rev.version if rev else "",
                        "revision_id": str(rev.id) if rev else "",
                        "status": rev.status if rev else "draft",
                        "check_out_user_id": str(rev.check_out_user_id) if (rev and rev.check_out_user_id) else None,
                        "check_out_user_name": checkout_user_name,
                        "has_3d": has_3d,
                    },
                })
            else:
                parts_data.append({
                    "id": str(p.id), "iteration_id": str(p.iteration_id),
                    "part_type": p.part_type, "part_id": str(p.part_id),
                    "is_required": p.is_required, "quantity": p.quantity, "sort_order": p.sort_order,
                    "part_detail": {},
                })

    # 子构型项（可用指定迭代或当前迭代）
    children_iter = child_iter if child_iter else current_iter
    children_data = []
    if children_iter:
        for c in crud.get_iteration_children(db, children_iter.id):
            child_rev = crud.get_config_item_revision(db, c.child_revision_id)
            child_master = crud.get_config_item_master(db, child_rev.master_id) if child_rev else None
            # 检查子构型项是否有下级
            child_iter = _get_current_iteration(db, c.child_revision_id) if child_rev else None
            has_children = False
            has_parts = False
            if child_iter:
                has_children = db.query(models.ConfigurationItemChild).filter(
                    models.ConfigurationItemChild.parent_iteration_id == child_iter.id
                ).limit(1).count() > 0
                has_parts = db.query(models.ConfigurationItemPart).filter(
                    models.ConfigurationItemPart.iteration_id == child_iter.id
                ).limit(1).count() > 0
            children_data.append({
                "id": str(c.id),
                "parent_iteration_id": str(c.parent_iteration_id),
                "child_revision_id": str(c.child_revision_id),
                "is_required": c.is_required, "sort_order": c.sort_order,
                "quantity": c.quantity,
                "has_children": has_children,
                "has_parts": has_parts,
                "child_detail": {
                    "id": str(child_rev.id) if child_rev else "",
                    "master_id": str(child_rev.master_id) if child_rev else "",
                    "code": child_master.code if child_master else "",
                    "name": child_master.name if child_master else "",
                    "version": child_rev.version if child_rev else "",
                    "status": child_rev.status if child_rev else "",
                    "check_out_user_id": str(child_rev.check_out_user_id) if (child_rev and child_rev.check_out_user_id) else None,
                    "check_out_user_name": _resolve_user_name(db, child_rev.check_out_user_id) if child_rev else None,
                } if child_rev else {},
            })

    # 关联图文档（当前迭代的 document_links）
    documents_data = _get_iteration_documents(db, current_iter, current_user) if current_iter else []

    # 版本历史
    versions = crud.list_revisions_by_master(db, master.id)
    versions_data = []
    for v in versions:
        v_checkout_name = _resolve_user_name(db, v.check_out_user_id)
        versions_data.append({
            "id": str(v.id),
            "master_id": str(v.master_id),
            "version": v.version,
            "status": v.status,
            "check_out_user_id": str(v.check_out_user_id) if v.check_out_user_id else None,
            "check_out_user_name": v_checkout_name,
            "check_out_date": v.check_out_date.isoformat() if v.check_out_date else None,
            "latest_iteration": v.latest_iteration,
            "creator_id": str(v.creator_id) if v.creator_id else None,
            "created_at": v.created_at.isoformat() if v.created_at else None,
        })

    return {
        "master": {
            "id": str(master.id), "code": master.code, "name": master.name,
            "creator_id": str(master.creator_id) if master.creator_id else None,
            "created_at": master.created_at.isoformat() if master.created_at else None,
            "updated_at": master.updated_at.isoformat() if master.updated_at else None,
        },
        "revision": {
            "id": str(revision.id), "master_id": str(revision.master_id),
            "version": revision.version, "status": revision.status,
            "check_out_user_id": str(revision.check_out_user_id) if revision.check_out_user_id else None,
            "check_out_user_name": checkout_user_name,
            "check_out_date": revision.check_out_date.isoformat() if revision.check_out_date else None,
            "latest_iteration": revision.latest_iteration,
            "creator_id": str(revision.creator_id) if revision.creator_id else None,
            "created_at": revision.created_at.isoformat() if revision.created_at else None,
            "iteration_id": str(current_iter.id) if current_iter else None,
            "name": current_iter.version_name if current_iter else master.name,
            "remark": current_iter.check_in_note if current_iter else "",
            "document_links": current_iter.document_links if current_iter else [],
        },
        "parts": parts_data,
        "children": children_data,
        "documents": documents_data,
        "versions": versions_data,
    }


@router.post("/items", response_model=dict)
async def create_config_item(
    data: schemas.ConfigItemCreate, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:create")),
):
    """创建构型项：同时创建 Master + Revision(A) + Iteration(1)，自动签出"""
    # 检查 code 是否已被未删除的 master 占用
    existing_master = crud.get_config_item_master_by_code(db, data.code)
    if existing_master:
        if existing_master.deleted_at is None:
            # 未删除 → 真正冲突
            has_active_rev = db.query(models.ConfigurationItemRevision).filter(
                models.ConfigurationItemRevision.master_id == existing_master.id,
                models.ConfigurationItemRevision.deleted_at.is_(None),
            ).count()
            if has_active_rev > 0:
                raise HTTPException(status_code=400, detail=f"构型号 {data.code} 已存在")
        # 已软删除 → 复活
        master, revision, iteration = crud.revive_config_item(
            db, existing_master, data.model_dump(), current_user.id
        )
        return {
            "id": str(revision.id), "master_id": str(master.id),
            "code": master.code, "name": master.name, "version": revision.version,
        }

    try:
        master, revision, iteration = crud.create_config_item(db, data.model_dump(), current_user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "id": str(revision.id), "master_id": str(master.id),
        "code": master.code, "name": master.name, "version": revision.version,
    }


@router.put("/items/{revision_id}", response_model=dict)
async def update_config_item(
    revision_id: str, data: schemas.ConfigItemUpdate, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:update")),
):
    """更新迭代层数据（需签出校验）"""
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    revision, iteration = result

    # 签出校验
    if revision.check_out_user_id is None:
        raise HTTPException(status_code=423, detail="请先签出后再编辑")
    if str(revision.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=423, detail="该版本已被他人签出，无法编辑")

    if not iteration:
        raise HTTPException(status_code=400, detail="当前迭代不存在")

    update_dict = data.model_dump(exclude_none=True)
    field_map = {"name": "version_name"}
    mapped = {}
    for k, v in update_dict.items():
        mapped[field_map.get(k, k)] = v

    if mapped:
        crud.update_config_item_iteration(db, iteration.id, mapped)

    return {"id": str(revision.id), "version": revision.version, "detail": "已保存"}


@router.delete("/items/{revision_id}")
async def delete_config_item(
    revision_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:delete")),
):
    """软删除构型项版本（检查父项引用）"""
    rev = crud.get_config_item_revision(db, UUID(revision_id))
    if not rev:
        raise HTTPException(status_code=404, detail="构型项版本不存在")

    # 检查是否被其他构型项的迭代引用为子项
    parent_refs = db.query(models.ConfigurationItemChild).filter(
        models.ConfigurationItemChild.child_revision_id == UUID(revision_id)
    ).all()
    if parent_refs:
        parent_iter_ids = [r.parent_iteration_id for r in parent_refs]
        parent_iters = db.query(models.ConfigurationItemIteration).filter(
            models.ConfigurationItemIteration.id.in_(parent_iter_ids)
        ).all()
        parent_rev_ids = [it.revision_id for it in parent_iters]
        parent_revs = db.query(models.ConfigurationItemRevision).filter(
            models.ConfigurationItemRevision.id.in_(parent_rev_ids),
            models.ConfigurationItemRevision.deleted_at.is_(None),
        ).all()
        parent_master_ids = [pr.master_id for pr in parent_revs]
        parent_masters = db.query(models.ConfigurationItemMaster).filter(
            models.ConfigurationItemMaster.id.in_(parent_master_ids),
            models.ConfigurationItemMaster.deleted_at.is_(None),
        ).all()
        if parent_masters:
            parent_codes = [m.code for m in parent_masters]
            raise HTTPException(
                status_code=400,
                detail=f"该构型项被 {len(parent_masters)} 个父构型项引用: {', '.join(parent_codes)}，无法删除"
            )

    if not crud.delete_config_item_revision(db, UUID(revision_id)):
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    return {"detail": "ok"}


# ════════════════════════════════════════════════════════
# 签出/签入/版本操作
# ════════════════════════════════════════════════════════

@router.post("/items/{revision_id}/checkout")
async def checkout_config_item(
    revision_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:checkout")),
):
    """签出构型项：创建新迭代，设置签出锁"""
    rev, err = crud.checkout_config_item(db, UUID(revision_id), current_user.id)
    if err:
        raise HTTPException(status_code=409 if "已被他人" in err else 400, detail=err)
    return {"ok": True, "latest_iteration": rev.latest_iteration}


@router.post("/items/{revision_id}/checkin")
async def checkin_config_item(
    revision_id: str,
    data: schemas.ConfigItemCheckin,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:checkin")),
):
    """签入构型项：记录签入说明，清除签出锁"""
    rev, err = crud.checkin_config_item(db, UUID(revision_id), current_user.id, data.check_in_note)
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True}


@router.post("/items/{revision_id}/undocheckout")
async def undocheckout_config_item(
    revision_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:undocheckout")),
):
    """撤销签出：删除最新迭代，回退 latest_iteration，清除签出锁"""
    rev, err = crud.undocheckout_config_item(db, UUID(revision_id), current_user.id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True}


@router.post("/items/{revision_id}/force-checkin")
async def force_checkin_config_item(
    revision_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:force_checkin")),
):
    """管理员强制签入：清除签出锁"""
    rev, err = crud.force_checkin_config_item(db, UUID(revision_id))
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True}


@router.post("/items/{revision_id}/upgrade")
async def upgrade_config_item(
    revision_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:create")),
):
    """升版：创建新版本，自动签出"""
    new_rev, err = crud.upgrade_config_item(db, UUID(revision_id), current_user.id)
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"id": str(new_rev.id), "version": new_rev.version}


@router.post("/items/{revision_id}/freeze")
async def freeze_config_item(
    revision_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:update")),
):
    """冻结构型项版本"""
    rev, err = crud.freeze_config_item(db, UUID(revision_id))
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True, "status": rev.status}


@router.post("/items/{revision_id}/release")
async def release_config_item(
    revision_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:update")),
):
    """发布构型项版本"""
    rev, err = crud.release_config_item(db, UUID(revision_id))
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True, "status": rev.status}


@router.post("/items/{revision_id}/obsolete")
async def obsolete_config_item(
    revision_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:update")),
):
    """作废构型项版本"""
    rev, err = crud.obsolete_config_item(db, UUID(revision_id))
    if err:
        raise HTTPException(status_code=400, detail=err)
    return {"ok": True, "status": rev.status}


@router.get("/items/{revision_id}/versions")
async def get_config_item_versions(
    revision_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:read")),
):
    """获取构型项所有版本历史"""
    rev = crud.get_config_item_revision(db, UUID(revision_id))
    if not rev:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    versions = crud.list_revisions_by_master(db, rev.master_id)
    result = []
    for v in versions:
        v_checkout_name = _resolve_user_name(db, v.check_out_user_id)
        result.append({
            "id": str(v.id),
            "master_id": str(v.master_id),
            "version": v.version,
            "status": v.status,
            "check_out_user_id": str(v.check_out_user_id) if v.check_out_user_id else None,
            "check_out_user_name": v_checkout_name,
            "check_out_date": v.check_out_date.isoformat() if v.check_out_date else None,
            "latest_iteration": v.latest_iteration,
            "creator_id": str(v.creator_id) if v.creator_id else None,
            "created_at": v.created_at.isoformat() if v.created_at else None,
        })
    return result


@router.get("/items/{revision_id}/iterations")
async def get_config_item_iterations(
    revision_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:read")),
):
    """获取构型项版本的所有迭代历史"""
    rev = crud.get_config_item_revision(db, UUID(revision_id))
    if not rev:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    iterations = crud.list_config_item_iterations(db, UUID(revision_id))
    result = []
    for it in iterations:
        result.append({
            "id": str(it.id),
            "iteration": it.iteration,
            "check_in_note": it.check_in_note or "",
            "version_name": it.version_name or "",
            "created_at": it.created_at.isoformat() if it.created_at else None,
        })
    return result


@router.delete("/items/{revision_id}/iterations/{iteration_id}")
async def delete_config_item_iteration(
    revision_id: str,
    iteration_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:delete")),
):
    """删除构型项迭代（仅管理员，且不能删除唯一迭代）"""
    rev = crud.get_config_item_revision(db, UUID(revision_id))
    if not rev:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    if rev.latest_iteration <= 1:
        raise HTTPException(status_code=400, detail="不能删除唯一迭代")
    it = crud.get_config_item_iteration_detail(db, UUID(iteration_id))
    if not it or str(it.revision_id) != revision_id:
        raise HTTPException(status_code=404, detail="迭代不存在")
    if it.iteration == rev.latest_iteration:
        # 删除最新迭代 = 撤销签出
        crud.undocheckout_config_item(db, UUID(revision_id), current_user.id)
    else:
        db.delete(it)
        db.commit()
    return {"ok": True}


# ════════════════════════════════════════════════════════
# 主数据更新（code/name 等 master 层字段）
# ════════════════════════════════════════════════════════

@router.patch("/items/{revision_id}/master", response_model=dict)
async def update_config_item_master(
    revision_id: str,
    data: schemas.ConfigItemUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:update")),
):
    """更新构型项主数据字段（code/name，需签出）"""
    rev = crud.get_config_item_revision(db, UUID(revision_id))
    if not rev:
        raise HTTPException(status_code=404, detail="构型项版本不存在")

    # 签出校验
    if rev.check_out_user_id is None:
        raise HTTPException(status_code=423, detail="请先签出后再编辑")
    if str(rev.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=423, detail="该版本已被他人签出，无法编辑")

    update_dict = data.model_dump(exclude_none=True)
    master = crud.update_config_item_master(db, rev.master_id, update_dict)
    if not master:
        raise HTTPException(status_code=404, detail="主数据不存在")
    return {
        "id": str(master.id), "code": master.code, "name": master.name,
    }


# ════════════════════════════════════════════════════════
# 关联零部件（迭代级）
# ════════════════════════════════════════════════════════

@router.get("/items/{revision_id}/parts", response_model=dict)
async def get_iteration_parts_endpoint(
    revision_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:read")),
):
    """获取当前迭代的关联零部件列表"""
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    _, iteration = result
    if not iteration:
        return {"parts": []}
    parts = crud.get_iteration_parts(db, iteration.id)
    return {"parts": [{
        "id": str(p.id), "iteration_id": str(p.iteration_id),
        "part_type": p.part_type, "part_id": str(p.part_id),
        "is_required": p.is_required, "quantity": p.quantity, "sort_order": p.sort_order,
    } for p in parts]}


@router.post("/items/{revision_id}/parts", response_model=dict)
async def add_parts(
    revision_id: str, data: schemas.ConfigPartBulkCreate, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.item:manage")),
):
    """批量关联零部件到当前迭代"""
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    revision, iteration = result
    if not iteration:
        raise HTTPException(status_code=400, detail="当前迭代不存在")
    # 签出校验
    if revision.check_out_user_id is None or str(revision.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=423, detail="请先签出后再编辑零部件")

    parts = crud.add_config_parts(db, str(iteration.id), data.items)
    return {"added": len(parts)}


@router.put("/items/{revision_id}/parts/{part_id}", response_model=dict)
async def update_part(
    revision_id: str, part_id: str, data: schemas.ConfigPartUpdate, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.item:manage")),
):
    """更新关联零部件属性"""
    part = crud.update_config_part(db, UUID(part_id), data.model_dump(exclude_none=True))
    if not part:
        raise HTTPException(status_code=404, detail="关联关系不存在")
    return {"id": str(part.id), "is_required": part.is_required, "quantity": part.quantity}


@router.delete("/items/{revision_id}/parts/{part_id}")
async def remove_part(
    revision_id: str, part_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.item:manage")),
):
    """移除关联零部件"""
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result or not result[1]:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    revision, _ = result
    if revision.check_out_user_id is None or str(revision.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=423, detail="请先签出后再编辑零部件")
    if not crud.remove_config_part(db, part_id):
        raise HTTPException(status_code=404, detail="关联关系不存在")
    return {"detail": "ok"}


# ════════════════════════════════════════════════════════
# 子构型项（迭代级）
# ════════════════════════════════════════════════════════

@router.get("/items/{revision_id}/children", response_model=dict)
async def get_iteration_children_endpoint(
    revision_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:read")),
):
    """获取当前迭代的子构型项列表"""
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    _, iteration = result
    if not iteration:
        return {"children": []}
    children = crud.get_iteration_children(db, iteration.id)
    children_list = []
    for c in children:
        child_rev = crud.get_config_item_revision(db, c.child_revision_id)
        child_master = crud.get_config_item_master(db, child_rev.master_id) if child_rev else None
        children_list.append({
            "id": str(c.id),
            "parent_iteration_id": str(c.parent_iteration_id),
            "child_revision_id": str(c.child_revision_id),
            "is_required": c.is_required,
            "quantity": c.quantity,
            "sort_order": c.sort_order,
            "child_detail": {
                "id": str(child_rev.id) if child_rev else "",
                "code": child_master.code if child_master else "",
                "name": child_master.name if child_master else "",
                "version": child_rev.version if child_rev else "",
            } if child_rev else {},
        })
    return {"children": children_list}


@router.post("/items/{revision_id}/children", response_model=dict)
async def add_children(
    revision_id: str, data: schemas.ConfigChildBulkCreate, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.item:manage")),
):
    """批量添加子构型项到当前迭代"""
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    revision, iteration = result
    if not iteration:
        raise HTTPException(status_code=400, detail="当前迭代不存在")
    # 签出校验
    if revision.check_out_user_id is None or str(revision.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=423, detail="请先签出后再编辑子构型项")
    # 防止自引用
    for c in data.items:
        child_rev = crud.get_config_item_revision(db, c.child_revision_id)
        if child_rev and child_rev.master_id == revision.master_id:
            raise HTTPException(status_code=400, detail="不能将构型项添加为自身的子项")

    children = crud.add_config_children(db, str(iteration.id), data.items)
    return {"added": len(children)}


@router.put("/items/{revision_id}/children/{child_id}", response_model=dict)
async def update_child(
    revision_id: str, child_id: str, data: schemas.ConfigChildUpdate, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.item:manage")),
):
    """更新子构型项属性（需签出）"""
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result or not result[1]:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    revision, _ = result
    if revision.check_out_user_id is None or str(revision.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=423, detail="请先签出后再编辑子构型项")
    child = crud.update_config_child(db, UUID(child_id), data.model_dump(exclude_none=True))
    if not child:
        raise HTTPException(status_code=404, detail="子构型项关系不存在")
    return {"id": str(child.id), "is_required": child.is_required}


@router.delete("/items/{revision_id}/children/{child_id}")
async def remove_child(
    revision_id: str, child_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.item:manage")),
):
    """移除子构型项（需签出）"""
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result or not result[1]:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    revision, _ = result
    if revision.check_out_user_id is None or str(revision.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=423, detail="请先签出后再编辑子构型项")
    if not crud.remove_config_child(db, child_id):
        raise HTTPException(status_code=404, detail="子构型项关系不存在")
    return {"detail": "ok"}


# ════════════════════════════════════════════════════════
# 关联图文档（迭代级 document_links JSONB）
# ════════════════════════════════════════════════════════

def _get_iteration_documents(db: Session, iteration: models.ConfigurationItemIteration, current_user=None) -> list:
    """从迭代的 document_links JSONB 读取关联图文档"""
    from .. import crud_groups
    from ..models import UserGroup, DocumentGroupLink
    links = iteration.document_links or []
    result = []
    doc_ids = [l.get("document_id") for l in links if l.get("document_id")]
    # document_id 在 links 中是 revision_id，需解析为 master_id 以查询用户组
    rev_to_master = {}
    if doc_ids:
        revs = db.query(DocumentRevision).filter(DocumentRevision.id.in_(doc_ids)).all()
        rev_to_master = {str(r.id): str(r.master_id) for r in revs}
    master_ids = list(set(rev_to_master.values()))
    doc_group_links = db.query(DocumentGroupLink).filter(DocumentGroupLink.document_id.in_(master_ids)).all() if master_ids else []
    doc_groups = {}
    for dgl in doc_group_links:
        doc_groups.setdefault(dgl.document_id, set()).add(dgl.group_id)
    all_gids = set()
    for gids in doc_groups.values():
        all_gids.update(gids)
    group_name_map = {}
    if all_gids:
        gs = db.query(UserGroup).filter(UserGroup.id.in_(all_gids)).all()
        group_name_map = {g.id: g.name for g in gs}
    for link in links:
        doc_id = link.get("document_id")
        doc_rev = db.query(DocumentRevision).filter(DocumentRevision.id == doc_id).first()
        if not doc_rev:
            continue
        master = doc_rev.master
        master_id_str = str(master.id) if master else None
        gids = doc_groups.get(master_id_str, set()) if master_id_str else set()
        # 从附件表获取文件信息
        file_name = None
        file_id = None
        latest_iter = db.query(DocumentIteration).filter(
            DocumentIteration.revision_id == doc_rev.id,
            DocumentIteration.iteration == doc_rev.latest_iteration,
        ).first()
        if latest_iter:
            first_att = db.query(DocumentAttachment).filter(
                DocumentAttachment.iteration_id == latest_iter.id,
            ).order_by(DocumentAttachment.created_at).first()
            if first_att:
                file_name = first_att.file_name
                file_id = str(first_att.id)
        doc_data = {
            "id": str(doc_rev.id),
            "code": master.code if master else "",
            "name": master.name if master else "",
            "version": doc_rev.version,
            "status": doc_rev.status,
            "file_name": file_name,
            "file_id": file_id,
        }
        if current_user and master:
            doc_data["accessible"] = crud_groups.document_is_accessible(db, current_user, master)
            doc_data["group_ids"] = [str(g) for g in gids]
            doc_data["group_names"] = [group_name_map.get(g, str(g)) for g in gids]
        result.append({
            "id": link.get("id"),
            "entity_type": "configuration",
            "entity_id": str(iteration.id),
            "document_id": str(doc_rev.id),
            "category": link.get("category"),
            "sort_order": link.get("sort_order", 0),
            "created_at": link.get("created_at"),
            "document": doc_data,
        })
    return result


@router.get("/items/{revision_id}/documents")
async def get_config_documents(
    revision_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration:read")),
):
    """获取构型项当前迭代关联的图文档列表"""
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    _, iteration = result
    if not iteration:
        return []
    return _get_iteration_documents(db, iteration, current_user)


@router.post("/items/{revision_id}/documents")
async def add_config_document(
    revision_id: str, body: core_schemas.EntityDocumentCreate, request: Request,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.doc:manage")),
):
    """关联图文档到构型项当前迭代"""
    doc_rev = db.query(DocumentRevision).filter(DocumentRevision.id == body.document_id).first()
    if not doc_rev:
        raise HTTPException(status_code=404, detail="图文档不存在")
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    revision, iteration = result
    if not iteration:
        raise HTTPException(status_code=400, detail="当前迭代不存在")
    # 签出校验
    if revision.check_out_user_id is None or str(revision.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=423, detail="请先签出后再关联图文档")

    link_id = str(body.id) if body.id else str(uuid.uuid4())
    link = {
        "id": link_id,
        "document_id": str(body.document_id),
        "category": body.category,
        "sort_order": body.sort_order,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    links = list(iteration.document_links or [])
    links.append(link)
    iteration.document_links = links
    flag_modified(iteration, 'document_links')
    db.commit()
    ip = request.client.host if request.client else None
    core_crud.create_log(db, current_user.id, current_user.username,
                         "关联图文档", "configuration", str(revision_id),
                         f"文档:{doc_rev.master.code if doc_rev.master else ''}", ip)
    return {"id": link_id, "message": "图文档关联成功"}


@router.put("/items/{revision_id}/documents/{link_id}")
async def update_config_document(
    revision_id: str, link_id: str, body: core_schemas.EntityDocumentUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.doc:manage")),
):
    """更新构型项关联图文档信息（类别/排序）"""
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    revision, iteration = result
    if not iteration:
        raise HTTPException(status_code=404, detail="当前迭代不存在")
    # 签出校验
    if revision.check_out_user_id is None or str(revision.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=423, detail="请先签出后再编辑关联图文档")
    links = list(iteration.document_links or [])
    found = false
    for link in links:
        if link.get("id") == link_id:
            if body.category is not None:
                link["category"] = body.category
            if body.sort_order is not None:
                link["sort_order"] = body.sort_order
            found = True
            break
    if not found:
        raise HTTPException(status_code=404, detail="关联关系不存在")
    iteration.document_links = links
    flag_modified(iteration, 'document_links')
    db.commit()
    return {"id": link_id, "message": "更新成功"}


@router.delete("/items/{revision_id}/documents/{link_id}")
async def remove_config_document(
    revision_id: str, link_id: str, db: Session = Depends(get_db),
    current_user=Depends(require_permission("configuration.doc:manage")),
):
    """移除构型项关联的图文档"""
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result:
        raise HTTPException(status_code=404, detail="构型项版本不存在")
    revision, iteration = result
    if not iteration:
        raise HTTPException(status_code=404, detail="当前迭代不存在")
    # 签出校验
    if revision.check_out_user_id is None or str(revision.check_out_user_id) != str(current_user.id):
        raise HTTPException(status_code=423, detail="请先签出后再编辑关联图文档")
    links = list(iteration.document_links or [])
    new_links = [l for l in links if l.get("id") != link_id]
    if len(new_links) == len(links):
        raise HTTPException(status_code=404, detail="关联关系不存在")
    iteration.document_links = new_links
    flag_modified(iteration, 'document_links')
    db.commit()
    return {"detail": "ok"}


# ════════════════════════════════════════════════════════
# 构型配置 (Configuration Profile)
# ════════════════════════════════════════════════════════

@router.get("/profiles", response_model=dict)
async def list_profiles(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: str = Query(None),
    status: str = Query(None),
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    """配置列表"""
    skip = (page - 1) * page_size
    profiles, total = crud.get_profiles_for_user(db, current_user, search=search, status=status, skip=skip, limit=page_size)
    return {
        "items": [{
            "id": str(p.id), "code": p.code, "name": p.name,
            "configuration_item_revision_id": str(p.configuration_item_revision_id) if p.configuration_item_revision_id else "",
            "status": p.status,
            "effectivity_start": p.effectivity_start or "",
            "effectivity_end": p.effectivity_end or "",
            "remark": p.remark or "",
            "creator_id": str(p.creator_id),
            "created_at": p.created_at.isoformat() if p.created_at else None,
            "updated_at": p.updated_at.isoformat() if p.updated_at else None,
            "review_mode": p.review_mode,
            "reviewer_count": len(p.reviewers or []),
        } for p in profiles],
        "total": total, "page": page, "page_size": page_size,
    }


@router.post("/profiles", response_model=dict)
async def create_profile(
    data: schemas.ConfigurationProfileCreate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:create")),
):
    """创建配置"""
    existing = crud.get_profile_by_code(db, data.code)
    if existing:
        raise HTTPException(status_code=400, detail="配置编号已存在")

    if data.configuration_item_revision_id:
        config_item = crud.get_config_item_revision(db, data.configuration_item_revision_id)
        if not config_item:
            raise HTTPException(status_code=404, detail="构型项版本不存在")

    profile = crud.create_profile(db, data, str(current_user.id))
    items = crud.get_working_items(db, str(profile.id))
    entity_map = _build_entity_map(db, items)

    config_item = crud.get_config_item_revision(db, profile.configuration_item_revision_id) if profile.configuration_item_revision_id else None
    config_master = crud.get_config_item_master(db, config_item.master_id) if config_item else None
    return {
        "id": str(profile.id), "code": profile.code, "name": profile.name,
        "configuration_item_revision_id": str(profile.configuration_item_revision_id) if profile.configuration_item_revision_id else "",
        "configuration_item": {
            "id": str(config_item.id), "code": config_master.code if config_master else "",
            "name": config_master.name if config_master else "",
        } if config_item else None,
        "status": profile.status,
        "effectivity_start": profile.effectivity_start or "",
        "effectivity_end": profile.effectivity_end or "",
        "remark": profile.remark or "",
        "creator_id": str(profile.creator_id),
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
        "items": [_format_profile_item(item, entity_map) for item in items],
    }


@router.get("/profiles/{profile_id}", response_model=dict)
async def get_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    """配置详情 + 清单"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")

    config_item = crud.get_config_item_revision(db, profile.configuration_item_revision_id) if profile.configuration_item_revision_id else None
    config_master = crud.get_config_item_master(db, config_item.master_id) if config_item else None
    working_items = crud.get_working_items(db, profile_id)
    formal_items = crud.get_profile_items(db, profile_id)
    entity_map = _build_entity_map(db, working_items)

    return {
        "id": str(profile.id), "code": profile.code, "name": profile.name,
        "configuration_item_revision_id": str(profile.configuration_item_revision_id) if profile.configuration_item_revision_id else "",
        "configuration_item": {
            "id": str(config_item.id), "code": config_master.code if config_master else "",
            "name": config_master.name if config_master else "",
        } if config_item else None,
        "status": profile.status,
        "effectivity_start": profile.effectivity_start or "",
        "effectivity_end": profile.effectivity_end or "",
        "remark": profile.remark or "",
        "creator_id": str(profile.creator_id),
        "created_at": profile.created_at.isoformat() if profile.created_at else None,
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
        "items": [_format_profile_item(item, entity_map) for item in working_items],
        "config_tree": _build_config_tree(db, str(profile.configuration_item_revision_id), working_items, entity_map) if profile.configuration_item_revision_id else None,
        "formal_items": [_format_profile_item(item) for item in formal_items],
        "reviewers": profile.reviewers or [],
        "review_mode": profile.review_mode,
        "cc_users": profile.cc_users or [],
        "review_records": [{
            "id": str(r.id), "reviewer_id": str(r.reviewer_id),
            "reviewer_name": r.reviewer_name, "decision": r.decision,
            "comment": r.comment or "",
            "created_at": r.created_at.isoformat() if r.created_at else None,
        } for r in crud.get_review_records(db, profile_id)],
        "status_logs": [{
            "id": str(l.id), "from_status": l.from_status, "to_status": l.to_status,
            "operator_name": l.operator_name, "comment": l.comment or "",
            "created_at": l.created_at.isoformat() if l.created_at else None,
        } for l in crud.get_status_logs(db, profile_id)],
        "submitted_at": profile.submitted_at.isoformat() if profile.submitted_at else None,
        "reviewed_at": profile.reviewed_at.isoformat() if profile.reviewed_at else None,
        "archived_at": profile.archived_at.isoformat() if profile.archived_at else None,
    }


@router.get("/profiles/{profile_id}/preview-3d", response_model=dict)
async def get_profile_3d_preview(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    """配置清单3D预览数据：收集所有选中零部件的STP模型"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if not profile.configuration_item_revision_id:
        return {
            "profile_code": profile.code,
            "profile_name": profile.name,
            "total_count": 0,
            "loaded_count": 0,
            "instances": [],
            "missing": [],
            "tree": [],
        }

    working_items = crud.get_working_items(db, profile_id)
    entity_map = _build_entity_map(db, working_items)
    config_tree = _build_config_tree(db, str(profile.configuration_item_revision_id), working_items, entity_map)

    parts = _collect_config_profile_parts(config_tree)
    if not parts:
        return {
            "profile_code": profile.code,
            "profile_name": profile.name,
            "total_count": 0,
            "loaded_count": 0,
            "instances": [],
            "missing": [],
            "tree": [],
        }

    instances = []
    missing = []
    identity_matrix = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

    part_model_map = {p["item_id"]: {"version": p.get("item_version") or "", "part_code": p["item_code"], "part_name": p["item_name"], "has_model": False} for p in parts}

    for idx, p in enumerate(parts):
        ver = (p.get("item_version") or "").strip()
        if not ver:
            from app.crud_parts import list_revisions_by_master
            revs = list_revisions_by_master(db, UUID(p["item_id"]))
            if revs:
                ver = revs[-1].version
            else:
                missing.append({
                    "part_code": p["item_code"],
                    "part_name": p["item_name"],
                    "version": "",
                })
                continue
        if p.get("item_id") in part_model_map:
            part_model_map[p["item_id"]]["version"] = ver

        result_3d = _resolve_part_stp_attachment(db, p["item_id"], ver)
        if result_3d and result_3d.get("glb_urls"):
            instances.append({
                "path": f"instance-{len(instances)}",
                "bom_path": [f"instance-{len(instances)}"],
                "part_code": p["item_code"],
                "part_name": p["item_name"],
                "version": ver,
                "revision_id": result_3d["revision_id"],
                "glb_urls": result_3d["glb_urls"],
                "matrix": identity_matrix,
                "bbox": None,
            })
        else:
            missing.append({
                "part_code": p["item_code"],
                "part_name": p["item_name"],
                "version": ver,
            })

    loaded_ids = {inst["part_code"] for inst in instances}
    for p in parts:
        if p["item_code"] in loaded_ids:
            part_model_map[p["item_id"]]["has_model"] = True

    def _build_config_tree_nodes(node: dict) -> dict | None:
        if not node:
            return None
        part_children = []
        for p in node.get("parts", []):
            if p.get("is_selected") and p.get("item_type") != "config_item":
                pid = p.get("item_id")
                info = part_model_map.get(pid) if pid else None
                part_children.append({
                    "bom_item_id": f"part-{pid}" if pid else f"part-{len(part_children)}",
                    "name": f"{p.get('item_code', '')}_{(info or {}).get('version', '')}_{p.get('item_name', '')}".strip("_"),
                    "type": "part",
                    "part_code": p.get("item_code", ""),
                    "part_name": p.get("item_name", ""),
                    "version": (info or {}).get("version", "") if info else "",
                    "has_model": (info or {}).get("has_model", False) if info else False,
                    "is_leaf": True,
                    "children": [],
                })
        config_children = []
        for child in node.get("children", []):
            if child.get("is_selected"):
                child_node = _build_config_tree_nodes(child)
                if child_node:
                    config_children.append(child_node)
        all_children = part_children + config_children
        node_has_model = any(c.get("has_model", False) for c in all_children)
        return {
            "bom_item_id": f"config-{node.get('id', '')}",
            "name": f"{node.get('code', '')}_{node.get('name', '')}",
            "type": "config_item",
            "part_code": "",
            "part_name": "",
            "has_model": node_has_model,
            "is_leaf": len(all_children) == 0,
            "children": all_children,
        }

    root_tree_node = _build_config_tree_nodes(config_tree) if config_tree else None

    flat_tree = []
    for idx, inst in enumerate(instances):
        flat_tree.append({
            "bom_item_id": f"instance-{idx}",
            "part_code": inst["part_code"],
            "part_name": inst["part_name"],
            "version": inst["version"],
            "quantity": 1,
            "instance_count": 1,
            "is_leaf": True,
            "children": [],
        })

    return {
        "profile_code": profile.code,
        "profile_name": profile.name,
        "total_count": len(parts),
        "loaded_count": len(instances),
        "instances": instances,
        "missing": missing,
        "tree": flat_tree,
        "config_tree_nodes": root_tree_node,
    }


@router.put("/profiles/{profile_id}", response_model=dict)
async def update_profile(
    profile_id: str,
    data: schemas.ConfigurationProfileUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:update")),
):
    """编辑配置（仅 draft）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可编辑")

    if data.code and data.code != profile.code:
        existing = crud.get_profile_by_code(db, data.code)
        if existing:
            raise HTTPException(status_code=400, detail="配置编号已存在")

    profile = crud.update_profile(db, profile_id, data)
    return {
        "id": str(profile.id), "code": profile.code, "name": profile.name,
        "status": profile.status,
        "effectivity_start": profile.effectivity_start or "",
        "effectivity_end": profile.effectivity_end or "",
        "remark": profile.remark or "",
        "updated_at": profile.updated_at.isoformat() if profile.updated_at else None,
    }


@router.delete("/profiles/{profile_id}")
async def delete_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:delete")),
):
    """删除配置（管理员可删除任意状态）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    crud.delete_profile(db, profile_id)
    return {"detail": "ok"}


@router.post("/profiles/{profile_id}/submit")
async def submit_profile_review(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:activate_archive")),
):
    """提交评审（draft→reviewing；无审批人→active）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可提交评审")
    profile = crud.submit_profile(db, profile, current_user)
    return {"detail": "ok", "status": profile.status}


@router.post("/profiles/{profile_id}/withdraw")
async def withdraw_profile_review(
    profile_id: str,
    data: schemas.ProfileWithdrawRequest = None,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:activate_archive")),
):
    """撤回评审（reviewing→draft）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "reviewing":
        raise HTTPException(status_code=400, detail="仅评审中状态可撤回")
    profile = crud.withdraw_profile(db, profile, current_user, (data.comment if data else "") or "")
    return {"detail": "ok", "status": profile.status}


@router.post("/profiles/{profile_id}/review")
async def review_profile_endpoint(
    profile_id: str,
    data: schemas.ProfileReviewRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    """审批操作（通过/驳回/退回）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if data.decision not in ("approved", "rejected", "returned"):
        raise HTTPException(status_code=400, detail="无效审批决定")
    profile = crud.review_profile(db, profile, current_user, data.decision, data.comment or "")
    return {"detail": "ok", "status": profile.status}


@router.post("/profiles/{profile_id}/reopen")
async def reopen_profile_endpoint(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:update")),
):
    """重新编辑（rejected→draft）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "rejected":
        raise HTTPException(status_code=400, detail="仅已驳回状态可重新编辑")
    profile = crud.reopen_profile(db, profile, current_user)
    return {"detail": "ok", "status": profile.status}


class ProfileStatusUpdate(BaseModel):
    status: str  # "draft" | "active" | "archived"


@router.put("/profiles/{profile_id}/status")
async def update_profile_status(
    profile_id: str,
    data: ProfileStatusUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:change_status")),
):
    """管理员直接修改状态"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if data.status not in ("draft", "reviewing", "active", "rejected", "archived"):
        raise HTTPException(status_code=400, detail="无效状态")
    old = profile.status
    crud._add_profile_status_log(db, profile.id, old, data.status,
                                 current_user.id, current_user.real_name, "管理员强制变更")
    crud.change_profile_status(db, profile_id, data.status)
    return {"detail": "ok", "status": data.status}


@router.post("/profiles/{profile_id}/archive")
async def archive_profile(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:activate_archive")),
):
    """归档（active/rejected → archived）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status not in ("active", "rejected"):
        raise HTTPException(status_code=400, detail="仅生效或已驳回状态可归档")
    profile = crud.archive_profile(db, profile, current_user)
    return {"detail": "ok", "status": profile.status}


@router.get("/profiles/{profile_id}/status-logs", response_model=dict)
async def get_profile_status_logs(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    return {"items": [{
        "id": str(l.id), "from_status": l.from_status, "to_status": l.to_status,
        "operator_name": l.operator_name, "comment": l.comment or "",
        "created_at": l.created_at.isoformat() if l.created_at else None,
    } for l in crud.get_status_logs(db, profile_id)]}


@router.post("/profiles/{profile_id}/cc")
async def add_profile_cc_endpoint(
    profile_id: str,
    data: schemas.ProfileCcAddRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    profile = crud.add_profile_cc(db, profile, data.user_id, data.user_name or "")
    return {"detail": "ok", "cc_users": profile.cc_users}


@router.delete("/profiles/{profile_id}/cc/{user_id}")
async def remove_profile_cc_endpoint(
    profile_id: str,
    user_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile:read")),
):
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    profile = crud.remove_profile_cc(db, profile, user_id)
    return {"detail": "ok", "cc_users": profile.cc_users}


class ChecklistRestoreItem(BaseModel):
    item_type: str
    item_code: str
    source_ci_code: str = ""
    is_selected: bool


class ChecklistRestoreRequest(BaseModel):
    items: list[ChecklistRestoreItem]


@router.put("/profiles/{profile_id}/restore-checklist", response_model=dict)
async def restore_profile_checklist(
    profile_id: str,
    data: ChecklistRestoreRequest,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile.bom:manage")),
):
    """按导入数据强制还原工作清单勾选（仅 draft）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可还原清单")

    working = crud.get_working_items(db, profile_id)

    # 工作表项的来源构型项 revision_id→code
    ci_ids = {str(wi.source_config_item_revision_id) for wi in working if wi.source_config_item_revision_id}
    code_by_id: dict[str, str] = {}
    if ci_ids:
        for rev in db.query(models.ConfigurationItemRevision).filter(
            models.ConfigurationItemRevision.id.in_(ci_ids)
        ).all():
            master = db.query(models.ConfigurationItemMaster).filter(
                models.ConfigurationItemMaster.id == rev.master_id
            ).first()
            code_by_id[str(rev.id)] = master.code if master else ""

    def _key(item_type: str, item_code: str, source_code: str) -> str:
        return f"{item_type}|{item_code}|{source_code}"

    target = {_key(it.item_type, it.item_code, it.source_ci_code): it.is_selected for it in data.items}
    matched: set[str] = set()

    for wi in working:
        src_code = code_by_id.get(str(wi.source_config_item_revision_id), "") if wi.source_config_item_revision_id else ""
        k = _key(wi.item_type, wi.item_code or "", src_code)
        if k in target:
            wi.is_selected = target[k]
            matched.add(k)

    db.flush()
    crud.sync_working_to_formal(db, profile_id)
    db.commit()

    unmatched = [k for k in target if k not in matched]
    return {"detail": "ok", "matched": len(matched), "unmatched": len(unmatched)}


@router.put("/profiles/{profile_id}/items/{item_id}", response_model=dict)
async def update_profile_item(
    profile_id: str,
    item_id: str,
    data: schemas.ConfigurationProfileItemUpdate,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile.bom:manage")),
):
    """勾选/取消可选件（仅 draft）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可修改清单")

    item = crud.get_working_items(db, profile_id)
    found = next((i for i in item if str(i.id) == item_id), None)
    if not found:
        raise HTTPException(status_code=404, detail="清单项不存在")
    if found.is_required:
        raise HTTPException(status_code=400, detail="必选项不可取消")

    updated = crud.update_working_item(db, item_id, data.is_selected)
    if not updated:
        raise HTTPException(status_code=400, detail="更新失败")
    return _format_profile_item(updated)


def _format_profile_item(item, entity_map: dict = None) -> dict:
    """格式化清单项响应"""
    entity = None
    if entity_map:
        rev_id = getattr(item, "part_revision_id", None)
        if rev_id:
            entity = entity_map.get(str(rev_id))
        if entity is None:
            entity = entity_map.get(str(item.item_id))
    result = {
        "id": str(item.id),
        "profile_id": str(item.profile_id),
        "source_config_item_revision_id": str(item.source_config_item_revision_id) if item.source_config_item_revision_id else None,
        "source_config_item_iteration_id": str(item.source_config_item_iteration_id) if item.source_config_item_iteration_id else None,
        "item_type": item.item_type,
        "item_id": str(item.item_id),
        "item_code": item.item_code or "",
        "item_name": item.item_name or "",
        "item_version": entity.version if entity and hasattr(entity, 'version') else "",
        "item_status": entity.status if entity and hasattr(entity, 'status') else "",
        "is_required": item.is_required,
        "is_selected": item.is_selected,
        "quantity": getattr(item, "quantity", 1) or 1,
        "source_type": item.source_type,
        "sort_order": item.sort_order,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }
    return result


def _build_entity_map(db: Session, items: list) -> dict:
    """批量查找零部件版本和状态 — 优先用 part_revision_id 精确查，空则取 master 最新版"""
    entity_map = {}
    # 先按 part_revision_id 精确查找
    rev_ids = [getattr(item, "part_revision_id", None) for item in items]
    rev_ids = [rid for rid in rev_ids if rid is not None]
    if rev_ids:
        revs = db.query(PartRevision).filter(PartRevision.id.in_(rev_ids)).all()
        for rev in revs:
            entity_map[str(rev.id)] = rev
    # 没有 part_revision_id 的（旧数据），按 master_id 取最新版兜底
    master_ids = list(set(str(item.item_id) for item in items
                         if not getattr(item, "part_revision_id", None)))
    for mid in master_ids:
        if mid in entity_map:
            continue
        rev = (
            db.query(PartRevision)
            .filter(
                PartRevision.master_id == mid,
                PartRevision.deleted_at.is_(None),
            )
            .order_by(PartRevision.created_at.desc())
            .first()
        )
        if rev:
            entity_map[mid] = rev
    return entity_map


def _build_config_tree(db: Session, revision_id: str, profile_items: list, entity_map: dict = None) -> dict:
    """构建构型项树形结构，含零部件和子构型项（revision_id 参数）"""
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result:
        return None
    revision, iteration = result
    master = crud.get_config_item_master(db, revision.master_id)
    if not master:
        return None

    # 本层级关联的零部件（含 direct 和 child 来源）
    parts = [
        _format_profile_item(pi, entity_map) for pi in profile_items
        if pi.source_config_item_revision_id and str(pi.source_config_item_revision_id) == revision_id
    ]

    # 子构型项（通过当前迭代）
    children = []
    if iteration:
        children = db.query(models.ConfigurationItemChild).filter(
            models.ConfigurationItemChild.parent_iteration_id == iteration.id
        ).order_by(models.ConfigurationItemChild.sort_order).all()

    child_nodes = []
    for child in children:
        child_tree = _build_config_tree(db, str(child.child_revision_id), profile_items, entity_map)
        if child_tree:
            child_tree["is_required"] = child.is_required
            child_tree["quantity"] = child.quantity
            child_tree["is_selected"] = child.is_required or _is_config_node_selected(db, str(child.child_revision_id), profile_items)
            child_nodes.append(child_tree)

    return {
        "id": str(revision.id),
        "code": master.code,
        "name": master.name,
        "is_required": True,
        "is_selected": True,
        "parts": parts,
        "children": child_nodes,
    }


def _resolve_part_stp_attachment(db: Session, master_id: str, version: str) -> dict | None:
    """按 (master_id, version) 查找零部件 STP 附件，返回 glb_urls 或 None"""
    rev = db.query(PartRevision).filter(
        PartRevision.master_id == UUID(master_id),
        PartRevision.version == version,
        PartRevision.deleted_at.is_(None),
    ).first()
    if not rev:
        return None

    iteration = db.query(PartIteration).filter(
        PartIteration.revision_id == rev.id,
        PartIteration.iteration == rev.latest_iteration,
    ).first()
    if not iteration:
        return None

    atts = db.query(PartAttachment).filter(
        PartAttachment.iteration_id == iteration.id,
    ).all()
    att = next((a for a in atts if is_stp_file(a.file_name) and a.category == 'production'), None)
    if not att:
        att = next((a for a in atts if is_stp_file(a.file_name)), None)
    if not att:
        return None

    token = mint_media_token(str(att.id), "gltf", ttl=3600)
    paths = get_lod_glb_paths(str(att.id), att.file_path, is_part=True)
    glb_base = get_glb_cache_path(str(att.id), att.file_path, is_part=True)
    has_lod = all(_os.path.exists(p) for p in paths.values())
    urls = {}
    if has_lod:
        for tier, p in paths.items():
            urls[tier] = f"/api/parts/attachments/{att.id}/lod/{tier}?token={token}"
    elif _os.path.exists(glb_base):
        fallback = f"/api/v2/attachments/{att.id}/gltf?token={token}"
        for tier in ("coarse", "normal", "fine"):
            urls[tier] = fallback
    else:
        fallback = f"/api/v2/attachments/{att.id}/gltf?token={token}"
        for tier in ("coarse", "normal", "fine"):
            urls[tier] = fallback

    return {
        "revision_id": str(rev.id),
        "glb_urls": urls,
    }


def _collect_config_profile_parts(config_tree: dict) -> list[dict]:
    """递归遍历 config_tree，收集所有选中零部件"""
    parts = []

    def walk(node: dict):
        if not node:
            return
        for p in node.get("parts", []):
            if p.get("is_selected") and p.get("item_type") != "config_item":
                parts.append({
                    "item_id": p.get("item_id"),
                    "item_code": p.get("item_code"),
                    "item_name": p.get("item_name"),
                    "item_version": p.get("item_version"),
                })
        for child in node.get("children", []):
            if child.get("is_selected"):
                walk(child)

    walk(config_tree)
    return parts


def _is_config_node_selected(db: Session, revision_id: str, profile_items: list) -> bool:
    """判断构型项节点是否已选（其下所有非可选部件有任意选中即算选中）"""
    for pi in profile_items:
        if pi.source_config_item_revision_id and str(pi.source_config_item_revision_id) == revision_id and pi.is_selected:
            return True
    # 递归检查子节点
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result:
        return False
    _, iteration = result
    if not iteration:
        return False
    children = db.query(models.ConfigurationItemChild).filter(
        models.ConfigurationItemChild.parent_iteration_id == iteration.id
    ).all()
    for child in children:
        if _is_config_node_selected(db, str(child.child_revision_id), profile_items):
            return True
    return False


@router.put("/profiles/{profile_id}/config-items/{config_item_id}/toggle", response_model=dict)
async def toggle_config_item_node(
    profile_id: str,
    config_item_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile.bom:manage")),
):
    """切换构型项节点及其下属所有零部件的勾选状态（仅 draft + 可选节点）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可修改")

    all_items = crud.get_working_items(db, profile_id)

    # config_item_id 是 revision_id
    node_selected = _is_config_node_selected(db, config_item_id, all_items)

    target_ids = _collect_descendant_config_item_ids(db, config_item_id)
    target_ids.add(config_item_id)

    toggled = []
    for pi in all_items:
        if pi.source_config_item_revision_id and str(pi.source_config_item_revision_id) in target_ids:
            crud.update_working_item(db, str(pi.id), not node_selected, force=True)
            toggled.append(str(pi.id))

    # 如果该可选节点下没有任何零部件，创建合成条目记录节点级选中态
    if len(toggled) == 0 and not node_selected:
        rev = crud.get_config_item_revision(db, UUID(config_item_id))
        master = crud.get_config_item_master(db, rev.master_id) if rev else None
        if rev and master:
            node_item = models.ConfigurationWorkingItem(
                profile_id=UUID(profile_id),
                source_config_item_revision_id=UUID(config_item_id),
                source_config_item_iteration_id=None,
                item_type='config_item',
                item_id=UUID(config_item_id),
                item_code=master.code,
                item_name=master.name,
                is_required=False,
                is_selected=True,
                source_type='child',
                sort_order=0,
            )
            db.add(node_item)
            db.commit()
            toggled.append(str(node_item.id))

    return {"detail": "ok", "toggled": len(toggled)}


@router.post("/profiles/{profile_id}/regenerate", response_model=dict)
async def regenerate_profile_checklist(
    profile_id: str,
    db: Session = Depends(get_db),
    current_user=Depends(require_permission("profile.bom:manage")),
):
    """以最新构型项内容强制重建配置清单（仅 draft）"""
    profile = crud.get_profile(db, profile_id)
    if not profile:
        raise HTTPException(status_code=404, detail="配置不存在")
    if profile.status != "draft":
        raise HTTPException(status_code=400, detail="仅草稿状态可修改")

    profile = crud.regenerate_profile_checklist(db, profile_id)
    if not profile:
        raise HTTPException(status_code=400, detail="重建失败，请先关联构型项")

    items = crud.get_working_items(db, profile_id)
    entity_map = _build_entity_map(db, items)
    return {
        "detail": "ok",
        "items": [_format_profile_item(item, entity_map) for item in items],
        "config_tree": _build_config_tree(db, str(profile.configuration_item_revision_id), items, entity_map),
    }


def _collect_descendant_config_item_ids(db: Session, revision_id: str) -> set:
    """递归收集所有子孙构型项 revision_id（通过迭代→child 关系）"""
    ids = set()
    result = crud.get_config_item_revision_with_iteration(db, UUID(revision_id))
    if not result:
        return ids
    _, iteration = result
    if not iteration:
        return ids
    children = db.query(models.ConfigurationItemChild).filter(
        models.ConfigurationItemChild.parent_iteration_id == iteration.id
    ).all()
    for child in children:
        cid = str(child.child_revision_id)
        ids.add(cid)
        ids.update(_collect_descendant_config_item_ids(db, cid))
    return ids
