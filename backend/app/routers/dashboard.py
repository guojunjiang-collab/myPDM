from fastapi import APIRouter, Body, Depends, HTTPException, Request
from sqlalchemy.orm import Session
import uuid

from ..database import get_db
from ..models import (
    User, DocumentMaster, DocumentRevision, UserDashboard, DashboardFolder,
    DashboardItem, DashboardFolderShare, DocumentAttachment
)
from ..models_parts import PartMaster, PartRevision, PartIteration, PartAttachment
from ..models_configuration import ConfigurationItemMaster, ConfigurationItemRevision
from ..permissions import require_permission, check_object_policy

router = APIRouter(prefix="/dashboard", tags=["用户看板"])

# 零部件统一后，看板关联的实体类型：component（旧数据兼容 part / assembly）
COMPONENT_ENTITY_TYPES = ("component", "part", "assembly")


def _checkout_name(db: Session, check_out_user_id) -> str | None:
    """检出人姓名（join User，real_name 兜底）"""
    if not check_out_user_id:
        return None
    user = db.query(User).filter(User.id == check_out_user_id).first()
    return user.real_name if user else None


def _build_component_item(item, rev: PartRevision, db: Session) -> dict:
    """构建零部件看板项：直接使用关联时指定的 revision；entity_type 按主档类型区分零件(part)/部件(assembly)"""
    master = db.query(PartMaster).filter(PartMaster.id == rev.master_id).first()
    mtype = master.type if master and master.type in ("part", "assembly") else "part"
    # 附件数：该 revision 下所有迭代的附件总数
    attachment_count = db.query(PartAttachment).join(
        PartIteration, PartIteration.id == PartAttachment.iteration_id
    ).filter(PartIteration.part_revision_id == rev.id).count()
    return {
        "id": item.id,
        "entity_type": mtype,
        "entity_id": str(rev.id),
        "master_id": str(rev.master_id),
        "code": master.code if master else "",
        "name": master.name if master else "",
        "version": rev.version,
        "status": rev.status,
        "check_out_user_name": _checkout_name(db, rev.check_out_user_id),
        "attachment_count": attachment_count,
    }


def _folder_to_dict(folder, db: Session, include_items=False, include_children=False, depth=0):
    """递归构建文件夹树"""
    # 检查是否有共享记录
    has_share = db.query(DashboardFolderShare).filter(
        DashboardFolderShare.folder_id == folder.id
    ).first() is not None
    
    result = {
        "id": folder.id,
        "parent_id": folder.parent_id,
        "name": folder.name,
        "sort_order": folder.sort_order,
        "created_at": folder.created_at.isoformat() if folder.created_at else None,
        "is_shared": has_share,
    }

    if include_items:
        items = db.query(DashboardItem).filter(
            DashboardItem.folder_id == folder.id
        ).all()
        item_list = []
        for item in items:
            if item.entity_type in COMPONENT_ENTITY_TYPES:
                rev = db.query(PartRevision).filter(
                    PartRevision.id == item.entity_id,
                    PartRevision.deleted_at.is_(None),
                ).first()
                if rev:
                    item_list.append(_build_component_item(item, rev, db))
            elif item.entity_type == "document":
                rev = db.query(DocumentRevision).filter(
                    DocumentRevision.id == item.entity_id,
                    DocumentRevision.deleted_at.is_(None),
                ).first()
                if rev:
                    master = db.query(DocumentMaster).filter(DocumentMaster.id == rev.master_id).first()
                    item_list.append({
                        "id": item.id,
                        "entity_type": "document",
                        "entity_id": str(rev.id),
                        "master_id": str(rev.master_id),
                        "code": master.code if master else "",
                        "name": master.name if master else "",
                        "version": rev.version,
                        "status": rev.status,
                        "check_out_user_name": _checkout_name(db, rev.check_out_user_id),
                        "attachment_count": db.query(DocumentAttachment).filter(
                            DocumentAttachment.revision_id == rev.id
                        ).count(),
                    })
            elif item.entity_type == "configuration":
                rev = db.query(ConfigurationItemRevision).filter(
                    ConfigurationItemRevision.id == item.entity_id,
                    ConfigurationItemRevision.deleted_at.is_(None),
                ).first()
                if rev:
                    master = db.query(ConfigurationItemMaster).filter(
                        ConfigurationItemMaster.id == rev.master_id
                    ).first()
                    item_list.append({
                        "id": item.id,
                        "entity_type": "configuration",
                        "entity_id": str(rev.id),
                        "master_id": str(rev.master_id),
                        "code": master.code if master else "",
                        "name": master.name if master else "",
                        "version": rev.version,
                        "status": rev.status,
                        "check_out_user_name": _checkout_name(db, rev.check_out_user_id),
                    })
        # 按名称排序
        item_list.sort(key=lambda x: x["name"])
        result["items"] = item_list

    if include_children and depth < 10:
        children = db.query(DashboardFolder).filter(
            DashboardFolder.parent_id == folder.id
        ).order_by(DashboardFolder.name).all()
        result["children"] = [
            _folder_to_dict(c, db, include_items, include_children, depth + 1)
            for c in children
        ]

    return result


def _get_descendant_ids(folder_id, db: Session):
    """获取文件夹及其所有子孙文件夹的 ID 列表（递归）"""
    ids = [folder_id]
    children = db.query(DashboardFolder.id).filter(
        DashboardFolder.parent_id == folder_id
    ).all()
    for child in children:
        ids.extend(_get_descendant_ids(child.id, db))
    return ids


def _get_ancestor_ids(folder_id, db: Session):
    """获取文件夹的所有祖先 ID（从父级向上追溯）"""
    ids = []
    current_id = folder_id
    visited = set()
    while current_id:
        if current_id in visited:
            break
        visited.add(current_id)
        folder = db.query(DashboardFolder).filter(DashboardFolder.id == current_id).first()
        if not folder or not folder.parent_id:
            break
        current_id = folder.parent_id
        ids.append(current_id)
    return ids


def _cascade_share(folder_id, user_id, permission, db: Session):
    """将共享权限级联写入所有子孙文件夹"""
    descendant_ids = _get_descendant_ids(folder_id, db)
    for fid in descendant_ids:
        # 跳过已有记录（保留已有的权限，不覆盖）
        existing = db.query(DashboardFolderShare).filter(
            DashboardFolderShare.folder_id == fid,
            DashboardFolderShare.shared_with_user_id == user_id,
        ).first()
        if not existing:
            share = DashboardFolderShare(
                folder_id=fid,
                shared_with_user_id=user_id,
                permission=permission,
            )
            db.add(share)


def _cascade_remove_share(folder_id, user_id, db: Session):
    """取消共享时级联移除所有子孙文件夹的共享记录"""
    descendant_ids = _get_descendant_ids(folder_id, db)
    db.query(DashboardFolderShare).filter(
        DashboardFolderShare.folder_id.in_(descendant_ids),
        DashboardFolderShare.shared_with_user_id == user_id,
    ).delete(synchronize_session=False)


def _ensure_dashboard(db: Session, user_id: uuid.UUID) -> UserDashboard:
    """确保用户有看板，没有则自动创建"""
    dash = db.query(UserDashboard).filter(UserDashboard.user_id == user_id).first()
    if not dash:
        dash = UserDashboard(user_id=user_id, name="我的看板")
        db.add(dash)
        db.commit()
        db.refresh(dash)
    return dash


# ===== 看板 =====

@router.get("/my-todos")
async def my_todos(db: Session = Depends(get_db), current_user: User = Depends(require_permission("dashboard:read"))):
    """待我处理：ECR/ECO 待我审批 + 我发起被驳回。只读。"""
    from app.crud_dashboard import get_my_todos
    return {"items": get_my_todos(db, current_user.id)}


@router.get("/")
async def get_dashboard(db: Session = Depends(get_db), current_user: User = Depends(require_permission("dashboard:read"))):
    """获取当前用户看板（含完整文件夹树 + 关联项 + 共享文件夹）"""
    dash = _ensure_dashboard(db, current_user.id)

    # 获取自己的文件夹树
    root_folders = db.query(DashboardFolder).filter(
        DashboardFolder.dashboard_id == dash.id,
        DashboardFolder.parent_id.is_(None)
    ).order_by(DashboardFolder.name).all()

    my_folders = [
        _folder_to_dict(f, db, include_items=True, include_children=True)
        for f in root_folders
    ]

    # 获取共享给我的文件夹（只取根级共享文件夹，子文件夹在树中递归展示）
    shares = db.query(DashboardFolderShare).filter(
        DashboardFolderShare.shared_with_user_id == current_user.id
    ).all()

    # 找出被共享的根级文件夹（其父级没有被共享的）
    shared_folder_ids = set(s.folder_id for s in shares)
    root_shared_ids = set()
    for fid in shared_folder_ids:
        ancestors = _get_ancestor_ids(fid, db)
        # 如果没有任何祖先也在共享列表中，说明这是根级共享文件夹
        if not any(a in shared_folder_ids for a in ancestors):
            root_shared_ids.add(fid)

    # 构建共享文件夹的映射：folder_id -> best permission
    share_permission_map = {}
    for s in shares:
        existing = share_permission_map.get(s.folder_id)
        if not existing or (existing == "view" and s.permission == "edit"):
            share_permission_map[s.folder_id] = s.permission

    shared_list = []
    for fid in root_shared_ids:
        folder = db.query(DashboardFolder).filter(DashboardFolder.id == fid).first()
        if folder:
            folder_dict = _folder_to_dict(folder, db, include_items=True, include_children=True)
            # 获取共享来源信息
            owner_dashboard = db.query(UserDashboard).filter(
                UserDashboard.id == folder.dashboard_id
            ).first()
            owner = None
            if owner_dashboard:
                owner = db.query(User).filter(User.id == owner_dashboard.user_id).first()
            folder_dict["shared_from"] = {
                "user_id": str(owner.id) if owner else None,
                "real_name": owner.real_name if owner else "未知",
                "permission": share_permission_map.get(fid, "view"),
            }
            shared_list.append(folder_dict)

    return {
        "id": dash.id,
        "name": dash.name,
        "folders": my_folders,
        "shared_folders": shared_list,
    }


@router.post("/init")
async def init_dashboard(db: Session = Depends(get_db), current_user: User = Depends(require_permission("dashboard:read"))):
    """初始化用户看板"""
    dash = _ensure_dashboard(db, current_user.id)
    return {"id": dash.id, "name": dash.name}


# ===== 文件夹 =====

@router.post("/folders")
async def create_folder(data: dict, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("dashboard.folder:create"))):
    """创建文件夹"""
    name = data.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="文件夹名称不能为空")

    parent_id = data.get("parent_id")
    parent = None
    target_dashboard_id = None

    if parent_id:
        # 查找父文件夹（不限制 dashboard_id，支持共享文件夹）
        parent = db.query(DashboardFolder).filter(
            DashboardFolder.id == parent_id
        ).first()
        if not parent:
            raise HTTPException(status_code=400, detail="父文件夹不存在")

        # 检查编辑权限（支持共享权限向上追溯）
        _check_folder_edit_permission(parent, current_user, db)

        # 新文件夹归属父文件夹所在的 dashboard（共享文件夹属于别人的 dashboard）
        target_dashboard_id = parent.dashboard_id
    else:
        # 无父文件夹，创建在当前用户的看板下
        dash = _ensure_dashboard(db, current_user.id)
        target_dashboard_id = dash.id

    # 同级去重：如果同级已有同名文件夹，自动编号
    name = _make_unique_folder_name(name, parent_id, db)

    folder = DashboardFolder(
        id=data.get("id"),
        dashboard_id=target_dashboard_id,
        parent_id=parent_id,
        name=name,
    )
    db.add(folder)
    db.commit()
    db.refresh(folder)

    # 如果新建在某个父文件夹下，继承父文件夹的共享权限
    if parent_id:
        parent_shares = db.query(DashboardFolderShare).filter(
            DashboardFolderShare.folder_id == parent_id
        ).all()
        for ps in parent_shares:
            existing = db.query(DashboardFolderShare).filter(
                DashboardFolderShare.folder_id == folder.id,
                DashboardFolderShare.shared_with_user_id == ps.shared_with_user_id,
            ).first()
            if not existing:
                new_share = DashboardFolderShare(
                    folder_id=folder.id,
                    shared_with_user_id=ps.shared_with_user_id,
                    permission=ps.permission,
                )
                db.add(new_share)
        db.commit()

    ip = request.client.host if request.client else None
    from .. import crud
    crud.create_log(db, current_user.id, current_user.username, "创建看板文件夹", "dashboard_folder", str(folder.id), f"名称:{name}", ip)

    return {"id": folder.id, "name": folder.name, "parent_id": folder.parent_id}


@router.put("/folders/{folder_id}")
async def update_folder(folder_id: uuid.UUID, data: dict, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("dashboard.folder:rename"))):
    """更新文件夹（重命名 / 移动）"""
    folder = db.query(DashboardFolder).filter(DashboardFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")

    # 权限检查：拥有者或有编辑权限
    _check_folder_edit_permission(folder, current_user, db)

    if "name" in data:
        name = data["name"].strip()
        if not name:
            raise HTTPException(status_code=400, detail="文件夹名称不能为空")
        folder.name = name

    if "parent_id" in data:
        new_parent_id = data["parent_id"]
        if new_parent_id:
            # 不能移到自己的子文件夹下
            if str(new_parent_id) == str(folder_id):
                raise HTTPException(status_code=400, detail="不能将文件夹移到自身下")
            # 检查循环引用
            if _is_descendant(folder_id, new_parent_id, db):
                raise HTTPException(status_code=400, detail="不能将文件夹移到其子文件夹下")
            parent = db.query(DashboardFolder).filter(DashboardFolder.id == new_parent_id).first()
            if not parent:
                raise HTTPException(status_code=400, detail="目标文件夹不存在")

            # 移动后继承新父文件夹的共享权限
            parent_shares = db.query(DashboardFolderShare).filter(
                DashboardFolderShare.folder_id == new_parent_id
            ).all()
            for ps in parent_shares:
                existing = db.query(DashboardFolderShare).filter(
                    DashboardFolderShare.folder_id == folder_id,
                    DashboardFolderShare.shared_with_user_id == ps.shared_with_user_id,
                ).first()
                if not existing:
                    new_share = DashboardFolderShare(
                        folder_id=folder_id,
                        shared_with_user_id=ps.shared_with_user_id,
                        permission=ps.permission,
                    )
                    db.add(new_share)
                    # 同时级联到子文件夹
                    _cascade_share(folder_id, ps.shared_with_user_id, ps.permission, db)

        folder.parent_id = new_parent_id

    db.commit()

    ip = request.client.host if request.client else None
    from .. import crud
    crud.create_log(db, current_user.id, current_user.username, "更新看板文件夹", "dashboard_folder", str(folder_id), None, ip)

    return {"id": folder.id, "name": folder.name, "parent_id": folder.parent_id}


@router.delete("/folders/{folder_id}")
async def delete_folder(folder_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("dashboard.folder:delete"))):
    """删除文件夹（级联删除子文件夹和关联项）"""
    folder = db.query(DashboardFolder).filter(DashboardFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")

    _check_folder_edit_permission(folder, current_user, db)

    # 只有管理员可以删除根文件夹
    if folder.parent_id is None and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="只有管理员可以删除根文件夹")

    name = folder.name
    # 显式递归删除：该文件夹 + 所有子文件夹 + 所有关联项 + 共享记录
    _delete_folder_cascade(folder_id, db)
    db.commit()

    ip = request.client.host if request.client else None
    from .. import crud
    crud.create_log(db, current_user.id, current_user.username, "删除看板文件夹", "dashboard_folder", str(folder_id), f"名称:{name}", ip)

    return {"message": "文件夹已删除"}


# ===== 关联项 =====

@router.post("/items")
async def add_items(data: dict, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("dashboard.item:add"))):
    """批量添加关联项到指定文件夹"""
    folder_id = data.get("folder_id")
    items = data.get("items", [])

    folder = db.query(DashboardFolder).filter(DashboardFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")

    _check_folder_edit_permission(folder, current_user, db)

    created = []
    for item_data in items:
        entity_type = item_data.get("entity_type")
        entity_id = item_data.get("entity_id")
        if entity_type not in COMPONENT_ENTITY_TYPES and entity_type not in ("document", "configuration"):
            continue

        # 验证实体存在（entity_id 为 revision_id）
        entity = None
        if entity_type in COMPONENT_ENTITY_TYPES:
            entity_type = "component"
            entity = db.query(PartRevision).filter(
                PartRevision.id == entity_id,
                PartRevision.deleted_at.is_(None),
            ).first()
        elif entity_type == "document":
            entity = db.query(DocumentRevision).filter(
                DocumentRevision.id == entity_id,
                DocumentRevision.deleted_at.is_(None),
            ).first()
        elif entity_type == "configuration":
            entity = db.query(ConfigurationItemRevision).filter(
                ConfigurationItemRevision.id == entity_id,
                ConfigurationItemRevision.deleted_at.is_(None),
            ).first()
        if not entity:
            continue

        # 检查是否已存在
        existing = db.query(DashboardItem).filter(
            DashboardItem.folder_id == folder_id,
            DashboardItem.entity_type == entity_type,
            DashboardItem.entity_id == entity_id,
        ).first()
        if existing:
            continue

        item = DashboardItem(
            folder_id=folder_id,
            entity_type=entity_type,
            entity_id=entity_id,
        )
        db.add(item)
        created.append(item)

    db.commit()

    ip = request.client.host if request.client else None
    from .. import crud
    crud.create_log(db, current_user.id, current_user.username, "添加看板关联项", "dashboard_item", str(folder_id), f"数量:{len(created)}", ip)

    return {"message": f"已添加 {len(created)} 个关联项", "count": len(created)}


@router.delete("/items/{item_id}")
async def delete_item(item_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("dashboard.item:delete"))):
    """移除单个关联项"""
    item = db.query(DashboardItem).filter(DashboardItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="关联项不存在")

    folder = db.query(DashboardFolder).filter(DashboardFolder.id == item.folder_id).first()
    if folder:
        _check_folder_edit_permission(folder, current_user, db)

    db.delete(item)
    db.commit()

    return {"message": "关联项已移除"}


# ===== 共享 =====

@router.get("/folders/{folder_id}/shares")
async def get_folder_shares(folder_id: uuid.UUID, db: Session = Depends(get_db), current_user: User = Depends(require_permission("dashboard:read"))):
    """查看文件夹共享列表（只显示直接设置的共享，不含继承的）"""
    folder = db.query(DashboardFolder).filter(DashboardFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")

    # 只有拥有者可以查看共享列表
    dash = db.query(UserDashboard).filter(UserDashboard.id == folder.dashboard_id).first()
    if not dash or dash.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只有文件夹拥有者可以查看共享列表")
    _check_folder_edit_permission(folder, current_user, db)

    shares = db.query(DashboardFolderShare).filter(
        DashboardFolderShare.folder_id == folder_id
    ).all()

    result = []
    for s in shares:
        user = db.query(User).filter(User.id == s.shared_with_user_id).first()
        result.append({
            "id": s.id,
            "folder_id": s.folder_id,
            "shared_with_user_id": s.shared_with_user_id,
            "shared_with_user": {
                "id": user.id,
                "username": user.username,
                "real_name": user.real_name,
            } if user else None,
            "permission": s.permission,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })

    return result


@router.post("/folders/{folder_id}/shares")
async def add_folder_share(folder_id: uuid.UUID, data: dict, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("dashboard.folder:share"))):
    """添加共享（权限自动继承到所有子文件夹）"""
    folder = db.query(DashboardFolder).filter(DashboardFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")

    # 只有拥有者可以共享
    dash = db.query(UserDashboard).filter(UserDashboard.id == folder.dashboard_id).first()
    if not dash or dash.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只有文件夹拥有者可以设置共享")
    _check_folder_edit_permission(folder, current_user, db)

    user_id = data.get("shared_with_user_id")
    permission = data.get("permission", "view")

    if not user_id:
        raise HTTPException(status_code=400, detail="请选择要共享的用户")
    if permission not in ("view", "edit"):
        raise HTTPException(status_code=400, detail="权限类型无效")

    # 不能共享给自己
    if str(user_id) == str(current_user.id):
        raise HTTPException(status_code=400, detail="不能共享给自己")

    # 验证用户存在
    target_user = db.query(User).filter(User.id == user_id).first()
    if not target_user:
        raise HTTPException(status_code=400, detail="目标用户不存在")

    # 检查是否已共享
    existing = db.query(DashboardFolderShare).filter(
        DashboardFolderShare.folder_id == folder_id,
        DashboardFolderShare.shared_with_user_id == user_id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="已共享给该用户")

    # 为该文件夹及所有子孙文件夹添加共享记录
    _cascade_share(folder_id, user_id, permission, db)
    db.commit()

    ip = request.client.host if request.client else None
    from .. import crud
    # 获取子文件夹数量用于日志
    descendant_count = len(_get_descendant_ids(folder_id, db)) - 1
    detail = f"共享给:{target_user.real_name}({permission})"
    if descendant_count > 0:
        detail += f"，含{descendant_count}个子文件夹"
    crud.create_log(db, current_user.id, current_user.username, "共享看板文件夹", "dashboard_share", str(folder_id), detail, ip)

    return {"message": f"已共享给 {target_user.real_name}" + (f"（含 {descendant_count} 个子文件夹）" if descendant_count > 0 else "")}


@router.put("/folders/{folder_id}/shares/{share_id}")
async def update_folder_share_permission(folder_id: uuid.UUID, share_id: uuid.UUID, data: dict, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("dashboard.folder:share"))):
    """修改共享权限（级联更新所有子文件夹的共享记录）"""
    share = db.query(DashboardFolderShare).filter(
        DashboardFolderShare.id == share_id,
        DashboardFolderShare.folder_id == folder_id,
    ).first()
    if not share:
        raise HTTPException(status_code=404, detail="共享记录不存在")

    folder = db.query(DashboardFolder).filter(DashboardFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")

    # 只有拥有者可以修改共享权限
    dash = db.query(UserDashboard).filter(UserDashboard.id == folder.dashboard_id).first()
    if not dash or dash.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只有文件夹拥有者可以修改共享权限")
    _check_folder_edit_permission(folder, current_user, db)

    permission = data.get("permission")
    if not permission or permission not in ("view", "edit"):
        raise HTTPException(status_code=400, detail="权限类型无效")

    if permission == share.permission:
        return {"message": "权限未变更"}

    # 更新当前记录
    old_permission = share.permission
    share.permission = permission

    # 级联更新该用户在所有子孙文件夹上的共享权限
    descendant_ids = _get_descendant_ids(folder_id, db)
    db.query(DashboardFolderShare).filter(
        DashboardFolderShare.folder_id.in_(descendant_ids),
        DashboardFolderShare.shared_with_user_id == share.shared_with_user_id,
    ).update({"permission": permission}, synchronize_session=False)

    db.commit()

    ip = request.client.host if request.client else None
    from .. import crud
    target_user = db.query(User).filter(User.id == share.shared_with_user_id).first()
    detail = f"共享权限变更:{target_user.real_name if target_user else '未知用户'} {old_permission}->{permission}"
    crud.create_log(db, current_user.id, current_user.username, "修改共享权限", "dashboard_share", str(folder_id), detail, ip)

    return {"message": f"已更新权限为 {'可编辑' if permission == 'edit' else '只读查看'}"}


@router.delete("/folders/{folder_id}/shares/{share_id}")
async def delete_folder_share(folder_id: uuid.UUID, share_id: uuid.UUID, request: Request, db: Session = Depends(get_db), current_user: User = Depends(require_permission("dashboard.folder:unshare"))):
    """取消共享（级联移除所有子文件夹的共享记录）"""
    share = db.query(DashboardFolderShare).filter(
        DashboardFolderShare.id == share_id,
        DashboardFolderShare.folder_id == folder_id,
    ).first()
    if not share:
        raise HTTPException(status_code=404, detail="共享记录不存在")

    # 级联移除该用户在所有子孙文件夹上的共享
    _cascade_remove_share(folder_id, share.shared_with_user_id, db)
    # 也删除根级记录
    db.delete(share)
    db.commit()

    ip = request.client.host if request.client else None
    from .. import crud
    crud.create_log(db, current_user.id, current_user.username, "取消看板文件夹共享", "dashboard_share", str(folder_id), None, ip)

    return {"message": "已取消共享"}


@router.post("/folders/{folder_id}/shares/batch")
async def save_folder_shares_batch(
    folder_id: uuid.UUID,
    data: dict,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("dashboard.folder:share"))
):
    """批量保存共享设置（原子操作：先清空再重建）"""
    folder = db.query(DashboardFolder).filter(DashboardFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")

    # 只有拥有者可以设置共享
    dash = db.query(UserDashboard).filter(UserDashboard.id == folder.dashboard_id).first()
    if not dash or dash.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="只有文件夹拥有者可以设置共享")
    _check_folder_edit_permission(folder, current_user, db)

    shares_data = data.get("shares", [])
    # 去重：同一用户只保留一条
    seen = set()
    unique_shares = []
    for s in shares_data:
        uid = s.get("shared_with_user_id")
        if not uid or uid in seen:
            continue
        if str(uid) == str(current_user.id):
            continue  # 不能共享给自己
        perm = s.get("permission", "view")
        if perm not in ("view", "edit"):
            perm = "view"
        seen.add(uid)
        unique_shares.append({"shared_with_user_id": uid, "permission": perm})

    # 获取该文件夹及所有子孙文件夹 ID
    all_folder_ids = _get_descendant_ids(folder_id, db)

    # 原子操作：先清空该文件夹及子孙上的所有共享记录
    db.query(DashboardFolderShare).filter(
        DashboardFolderShare.folder_id.in_(all_folder_ids),
    ).delete(synchronize_session=False)

    # 重建共享（含级联）
    for s in unique_shares:
        _cascade_share(folder_id, s["shared_with_user_id"], s["permission"], db)

    db.commit()

    ip = request.client.host if request.client else None
    from .. import crud
    crud.create_log(db, current_user.id, current_user.username, "批量保存共享设置", "dashboard_share", str(folder_id), f"共享用户数:{len(unique_shares)}", ip)

    return {"message": "共享设置已保存", "share_count": len(unique_shares)}


@router.delete("/shared-folder/{folder_id}")
async def remove_shared_folder(
    folder_id: uuid.UUID,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("dashboard.folder:unshare"))
):
    """被共享者从自己看板移除共享文件夹（主动退出，不删除原文件夹）"""
    folder = db.query(DashboardFolder).filter(DashboardFolder.id == folder_id).first()
    if not folder:
        raise HTTPException(status_code=404, detail="文件夹不存在")

    # 向上追溯找到最顶层的被共享文件夹
    ancestor_ids = _get_ancestor_ids(folder_id, db)
    all_check_ids = [folder_id] + ancestor_ids

    # 从根级向下查找第一个共享记录（即最顶层被共享的文件夹）
    root_share_folder_id = None
    for fid in reversed(all_check_ids):
        share = db.query(DashboardFolderShare).filter(
            DashboardFolderShare.folder_id == fid,
            DashboardFolderShare.shared_with_user_id == current_user.id
        ).first()
        if share:
            root_share_folder_id = fid
            break

    if not root_share_folder_id:
        raise HTTPException(status_code=403, detail="没有该文件夹的共享记录")

    # 级联移除该用户在所有子孙文件夹上的共享
    _cascade_remove_share(root_share_folder_id, current_user.id, db)
    # 删除根级共享记录
    db.query(DashboardFolderShare).filter(
        DashboardFolderShare.folder_id == root_share_folder_id,
        DashboardFolderShare.shared_with_user_id == current_user.id,
    ).delete(synchronize_session=False)

    db.commit()

    ip = request.client.host if request.client else None
    from .. import crud
    crud.create_log(db, current_user.id, current_user.username, "移除共享文件夹", "dashboard_share", str(folder_id), None, ip)

    return {"message": "已移除共享文件夹"}



# ===== 辅助函数 =====

def _make_unique_folder_name(name, parent_id, db: Session):
    """同级文件夹去重：如果同名则自动编号，如 '新建文件夹 (2)'"""
    query = db.query(DashboardFolder.name).filter(
        DashboardFolder.parent_id == parent_id if parent_id else DashboardFolder.parent_id.is_(None),
    )
    existing_names = set(row[0] for row in query.all())
    if name not in existing_names:
        return name
    # 找最小可用编号
    n = 2
    while True:
        candidate = f"{name} ({n})"
        if candidate not in existing_names:
            return candidate
        n += 1


def _delete_folder_cascade(folder_id, db: Session):
    """递归删除文件夹及其所有子文件夹、关联项、共享记录（显式删除，不依赖 ORM cascade）"""
    # 1. 先递归删除子文件夹
    children = db.query(DashboardFolder).filter(DashboardFolder.parent_id == folder_id).all()
    for child in children:
        _delete_folder_cascade(child.id, db)
    # 2. 删除该文件夹的关联项
    db.query(DashboardItem).filter(DashboardItem.folder_id == folder_id).delete(synchronize_session=False)
    # 3. 删除该文件夹的共享记录
    db.query(DashboardFolderShare).filter(DashboardFolderShare.folder_id == folder_id).delete(synchronize_session=False)
    # 4. 删除该文件夹本身
    db.query(DashboardFolder).filter(DashboardFolder.id == folder_id).delete(synchronize_session=False)


def _check_folder_edit_permission(folder, user, db):
    """文件夹编辑权门禁 —— 全模块唯一入口。

    判定委托给注册策略 `dashboard_folder_editor`，本函数只负责算出策略所需的
    上下文：看板所有者 + 在本文件夹或其任一祖先上被授予 edit 的用户集合。
    （DashboardFolder 模型既无 owner 列也无法表达祖先继承，故不能让策略自己去取。）
    """
    dash = db.query(UserDashboard).filter(UserDashboard.id == folder.dashboard_id).first()
    if not dash:
        raise HTTPException(status_code=404, detail="看板不存在")

    # 向上追溯：本文件夹 + 全部祖先上的 edit 共享
    all_check_ids = [folder.id] + _get_ancestor_ids(folder.id, db)
    editor_ids = {
        s.shared_with_user_id
        for s in db.query(DashboardFolderShare).filter(
            DashboardFolderShare.folder_id.in_(all_check_ids),
            DashboardFolderShare.permission == "edit",
        ).all()
    }
    if not check_object_policy("dashboard_folder_editor", user, folder,
                               owner_user_id=dash.user_id, editor_user_ids=editor_ids):
        raise HTTPException(status_code=403, detail="无权编辑此文件夹")


def _is_descendant(parent_id, child_id, db):
    """检查 child_id 是否是 parent_id 的后代（用于防止循环引用）"""
    current = child_id
    visited = set()
    while current:
        if str(current) == str(parent_id):
            return True
        if current in visited:
            break
        visited.add(current)
        folder = db.query(DashboardFolder).filter(DashboardFolder.id == current).first()
        if not folder or not folder.parent_id:
            break
        current = folder.parent_id
    return False
