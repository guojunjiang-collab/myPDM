"""
附件管理路由 - 支持文件系统存储和分块上传
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from sqlalchemy.orm import Session
import uuid
import os
import logging
import asyncio
from pathlib import Path

from ..database import get_db
from ..models import User, DocumentAttachment, Document, Component
from ..file_storage import file_storage, chunked_uploader, MAX_FILE_SIZE, CHUNK_SIZE
from .auth import get_current_active_user
from ..permissions import require_permission, has_permission
from ..media_token import mint_media_token, verify_media_token
from .. import crud_groups
from ..stp_converter import is_stp_file, convert_stp_to_gltf, get_gltf_path_for_attachment, delete_glb_cache
from ..office_converter import (
    is_office_file, convert_office_to_pdf,
    get_pdf_path_for_attachment, delete_pdf_cache,
)
from ..bom.archive_reader import read_archive_tree, extract_file, SUPPORTED_EXTENSIONS
import zipfile
import tarfile

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/attachments", tags=["附件管理"])

import mimetypes as _mimetypes

# 文本类扩展名：统一以 UTF-8 纯文本内嵌，避免 md/log 被当二进制下载、避免中文乱码
_TEXT_PREVIEW_EXTS = {".txt", ".md", ".csv", ".log", ".json", ".xml"}


def _preview_media_type(filename: str) -> str:
    """预览时的 Content-Type：文本类统一 UTF-8 纯文本，其余按扩展名猜测"""
    ext = Path(filename).suffix.lower()
    if ext in _TEXT_PREVIEW_EXTS:
        return "text/plain; charset=utf-8"
    return _mimetypes.guess_type(filename)[0] or "application/octet-stream"


def _attachment_response(att):
    return {
        "id": att.id,
        "file_name": att.file_name,
        "file_size": att.file_size,
        "file_path": att.file_path,
        "created_at": att.created_at,
        "updated_at": att.updated_at,
    }


def _resolve_attachment(db, attachment_id):
    from ..models import ComponentAttachment
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == attachment_id).first()
    if att:
        return att, "document"
    catt = db.query(ComponentAttachment).filter(ComponentAttachment.id == attachment_id).first()
    if catt:
        return catt, "component"
    return None, None


@router.get("/")
async def list_attachments(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:list"))
):
    """获取附件列表"""
    attachments = db.query(DocumentAttachment).all()
    return [_attachment_response(a) for a in attachments]


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    entity_type: str = Form("document"),
    entity_id: str = Form(...),
    category: str = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:upload"))
):
    """
    上传文件（小文件直接上传）
    
    Args:
        file: 上传的文件
        entity_type: 实体类型 (document, part, assembly)
        entity_id: 实体ID
        
    Returns:
        文件信息
    """
    # 读取文件内容
    file_data = await file.read()
    
    # 检查文件大小
    file_size = len(file_data)
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413, 
            detail=f"文件大小 {file_size / 1024 / 1024:.2f}MB 超过限制 {MAX_FILE_SIZE / 1024 / 1024:.2f}MB"
        )
    
    # 如果文件较大，建议使用分块上传
    if file_size > CHUNK_SIZE * 2:
        return {
            "status": "suggest_chunked",
            "message": "文件较大，建议使用分块上传",
            "file_size": file_size,
            "chunk_size": CHUNK_SIZE,
            "total_chunks": (file_size + CHUNK_SIZE - 1) // CHUNK_SIZE,
        }
    
    try:
        # 保存文件到文件系统（图文档使用 编号_版本 作为文件夹名）
        folder_name = None
        if entity_type in ("document", "documents"):
            doc = db.query(Document).filter(Document.id == uuid.UUID(entity_id)).first()
            if doc:
                folder_name = f"{doc.code}_{doc.version}"
        elif entity_type in ("component", "components"):
            from ..models import Component
            comp = db.query(Component).filter(Component.id == uuid.UUID(entity_id)).first()
            if comp:
                folder_name = f"{comp.code}_{comp.version}"
        result = file_storage.save_file(
            file_data,
            entity_type,
            entity_id,
            file.filename or "unnamed",
            folder_name=folder_name,
        )

        # 零部件附件：写入独立表 component_attachments
        if entity_type in ("component", "components"):
            from ..models import ComponentAttachment
            catt_id = uuid.uuid4()
            new_catt = ComponentAttachment(
                id=catt_id,
                component_id=uuid.UUID(entity_id),
                category=category or "cad",
                file_name=result["filename"],
                file_size=result["file_size"],
                file_path=result["file_path"],
                file_hash=result.get("file_hash", ""),
            )
            db.add(new_catt)
            db.commit()
            db.refresh(new_catt)
            return {
                "id": new_catt.id,
                "file_name": result["filename"],
                "file_size": result["file_size"],
                "file_path": result["file_path"],
                "message": "文件上传成功",
            }

        # 创建数据库记录
        att_id = str(uuid.uuid4())
        new_att = DocumentAttachment(
            id=att_id,
            document_id=uuid.UUID(entity_id) if entity_type in ("document", "documents") else None,
            file_name=result["filename"],
            file_size=result["file_size"],
            file_path=result["file_path"],  # 保存文件路径
            file_hash=result.get("file_hash", ""),  # 保存文件哈希
        )
        
        db.add(new_att)
        db.flush()  # 先刷新到数据库，确保记录被创建
        
        # 如果是图文档，更新 documents 表的 file_name 和 file_id
        if entity_type in ("document", "documents"):
            doc = db.query(Document).filter(Document.id == uuid.UUID(entity_id)).first()
            if doc:
                doc.file_name = result["filename"]
                doc.file_id = uuid.UUID(att_id)
        
        db.commit()
        db.refresh(new_att)
        
        # STP 文件不再自动转换，改为预览时按需转换（避免批量导入卡死）
        return {
            "id": new_att.id,
            "file_name": result["filename"],
            "file_size": result["file_size"],
            "file_path": result["file_path"],
            "message": "文件上传成功",
        }
        
    except HTTPException:
        raise  # 重新抛出 HTTPException
    except ValueError as e:
        # 文件校验失败（不允许的扩展名 / 文件名非法 / 无效实体类型 / 超大）属于客户端数据问题
        raise HTTPException(status_code=400, detail=f"文件上传失败: {str(e)}")
    except Exception as e:
        import traceback
        traceback.print_exc()  # 输出详细的错误信息到日志
        raise HTTPException(status_code=500, detail=f"文件上传失败: {str(e)}")


@router.post("/chunk/init")
async def init_chunked_upload(
    filename: str = Form(...),
    file_size: int = Form(...),
    entity_type: str = Form("document"),
    entity_id: str = Form(...),
    category: str = Form(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:upload"))
):
    """
    初始化分块上传
    
    Args:
        filename: 文件名
        file_size: 文件总大小
        entity_type: 实体类型
        entity_id: 实体ID
        
    Returns:
        上传ID和分块信息
    """
    # 计算分块数
    total_chunks = (file_size + CHUNK_SIZE - 1) // CHUNK_SIZE
    
    try:
        # 图文档使用 编号_版本 作为文件夹名
        folder_name = None
        if entity_type in ("document", "documents"):
            doc = db.query(Document).filter(Document.id == uuid.UUID(entity_id)).first()
            if doc:
                folder_name = f"{doc.code}_{doc.version}"
        elif entity_type in ("component", "components"):
            from ..models import Component
            comp = db.query(Component).filter(Component.id == uuid.UUID(entity_id)).first()
            if comp:
                folder_name = f"{comp.code}_{comp.version}"
        meta = chunked_uploader.init_upload(
            filename,
            file_size,
            entity_type,
            entity_id,
            total_chunks,
            folder_name=folder_name,
            category=category,
        )
        
        return {
            "upload_id": meta["upload_id"],
            "total_chunks": total_chunks,
            "chunk_size": CHUNK_SIZE,
            "message": "分块上传初始化成功",
        }
        
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/chunk/upload")
async def upload_chunk(
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    chunk: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:upload"))
):
    """
    上传分块
    
    Args:
        upload_id: 上传ID
        chunk_index: 分块索引（从0开始）
        chunk: 分块数据
        
    Returns:
        上传进度信息
    """
    # 读取分块数据
    chunk_data = await chunk.read()
    
    try:
        result = chunked_uploader.upload_chunk(upload_id, chunk_index, chunk_data)
        
        return {
            "upload_id": result["upload_id"],
            "chunk_index": result["chunk_index"],
            "uploaded_chunks": result["uploaded_chunks"],
            "total_chunks": result["total_chunks"],
            "progress": len(result["uploaded_chunks"]) / result["total_chunks"] * 100,
            "is_complete": result["is_complete"],
            "message": f"分块 {chunk_index} 上传成功",
        }
        
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/chunk/complete")
async def complete_chunked_upload(
    upload_id: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:upload"))
):
    """
    完成分块上传
    
    Args:
        upload_id: 上传ID
        
    Returns:
        最终文件信息
    """
    try:
        result = chunked_uploader.complete_upload(upload_id)
        file_info = result["file_info"]

        if file_info["entity_type"] in ("component", "components"):
            from ..models import ComponentAttachment
            catt_id = uuid.uuid4()
            new_catt = ComponentAttachment(
                id=catt_id,
                component_id=uuid.UUID(file_info["entity_id"]),
                category=file_info.get("category") or "cad",
                file_name=file_info["filename"],
                file_size=file_info["file_size"],
                file_path=file_info["file_path"],
                file_hash=file_info.get("file_hash", ""),
            )
            db.add(new_catt)
            db.commit()
            db.refresh(new_catt)
            return {
                "id": new_catt.id,
                "file_name": file_info["filename"],
                "file_size": file_info["file_size"],
                "file_path": file_info["file_path"],
                "status": "completed",
                "message": "文件上传完成",
            }

        # 创建数据库记录
        att_id = str(uuid.uuid4())
        new_att = DocumentAttachment(
            id=att_id,
            document_id=uuid.UUID(file_info["entity_id"]) if file_info["entity_type"] in ("document", "documents") else None,
            file_name=file_info["filename"],
            file_size=file_info["file_size"],
            file_path=file_info["file_path"],  # 保存文件路径
            file_hash=file_info.get("file_hash", ""),  # 保存文件哈希
        )
        
        db.add(new_att)
        db.flush()  # 先刷新到数据库，确保记录被创建
        
        # 如果是图文档，更新 documents 表的 file_name 和 file_id
        print(f"[DEBUG] entity_type: {file_info['entity_type']}, entity_id: {file_info['entity_id']}")
        if file_info["entity_type"] in ("document", "documents"):
            doc = db.query(Document).filter(Document.id == uuid.UUID(file_info["entity_id"])).first()
            print(f"[DEBUG] doc query result: {doc}")
            if doc:
                doc.file_name = file_info["filename"]
                doc.file_id = uuid.UUID(att_id)
                print(f"[DEBUG] Updated doc: file_name={doc.file_name}, file_id={doc.file_id}")
        
        db.commit()
        db.refresh(new_att)
        
        # STP 文件不再自动转换，改为预览时按需转换（避免批量导入卡死）
        return {
            "id": new_att.id,
            "file_name": file_info["filename"],
            "file_size": file_info["file_size"],
            "file_path": file_info["file_path"],
            "status": "completed",
            "message": "文件上传完成",
        }
        
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/chunk/status/{upload_id}")
async def get_upload_status(
    upload_id: str,
    current_user: User = Depends(require_permission("attachments:upload"))
):
    """
    获取上传状态
    
    Args:
        upload_id: 上传ID
        
    Returns:
        上传状态信息
    """
    try:
        status = chunked_uploader.get_upload_status(upload_id)
        return status
        
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.delete("/chunk/cancel/{upload_id}")
async def cancel_upload(
    upload_id: str,
    current_user: User = Depends(require_permission("attachments:upload"))
):
    """
    取消上传
    
    Args:
        upload_id: 上传ID
        
    Returns:
        取消结果
    """
    success = chunked_uploader.cancel_upload(upload_id)
    
    if success:
        return {"message": "上传已取消"}
    else:
        raise HTTPException(status_code=404, detail="上传不存在")


# ── 管理端点：批量转换（必须在 /{attachment_id} 之前，避免路由冲突）──

@router.post("/convert-pending")
async def convert_pending_stp(
    current_user: User = Depends(require_permission("attachments:convert_manage")),
    db: Session = Depends(get_db),
):
    """扫描所有未转换的 STP 附件并后台批量转换（仅管理员）"""
    stp_atts = db.query(DocumentAttachment).filter(
        (DocumentAttachment.file_name.ilike('%.stp')) |
        (DocumentAttachment.file_name.ilike('%.step'))
    ).all()
    pending = []
    for att in stp_atts:
        if get_gltf_path_for_attachment(str(att.id), att.file_path) is None:
            pending.append(att)
    if not pending:
        return {"status": "done", "message": "所有 STP 文件已转换", "converted": 0, "total": 0}
    loop = asyncio.get_event_loop()
    async def batch_convert():
        converted = failed = 0
        for att in pending:
            try:
                stp_path = file_storage.base_dir / att.file_path
                if not stp_path.exists(): failed += 1; continue
                await loop.run_in_executor(None, convert_stp_to_gltf, str(stp_path), str(att.id), att.file_path)
                converted += 1
            except Exception: failed += 1
    asyncio.create_task(batch_convert())
    return {"status": "started", "message": f"开始批量转换 {len(pending)} 个 STP 文件", "pending": len(pending), "total_stp": len(stp_atts)}


@router.get("/convert-status")
async def convert_status(
    current_user: User = Depends(require_permission("attachments:convert_manage")),
    db: Session = Depends(get_db),
):
    """查询待转换的 STP 数量（用于轮询批量转换进度）"""
    stp_atts = db.query(DocumentAttachment).filter(
        (DocumentAttachment.file_name.ilike('%.stp')) |
        (DocumentAttachment.file_name.ilike('%.step'))
    ).all()
    pending = sum(1 for att in stp_atts if get_gltf_path_for_attachment(str(att.id), att.file_path) is None)
    return {"pending": pending, "total": len(stp_atts)}


@router.get("/{attachment_id}")
async def get_attachment(
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:list"))
):
    """获取单个附件信息"""
    att, _att_source = _resolve_attachment(db, attachment_id)
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    crud_groups.enforce_attachment_content_access(db, current_user, attachment_id)
    
    # 如果有文件路径，从文件系统读取
    if hasattr(att, 'file_path') and att.file_path:
        try:
            file_data = file_storage.read_file(att.file_path)
            return {
                **_attachment_response(att),
                "file_data": file_data,  # 返回二进制数据
            }
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="文件不存在")
    
    # 否则从数据库读取（向后兼容）
    return {
        **_attachment_response(att),
        "file_data": att.file_data,
    }


@router.get("/{attachment_id}/download")
async def download_attachment(
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:download"))
):
    """下载附件"""
    import base64
    
    att, _att_source = _resolve_attachment(db, attachment_id)
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    crud_groups.enforce_attachment_content_access(db, current_user, attachment_id)
    
    # 如果有文件路径，从文件系统读取
    if hasattr(att, 'file_path') and att.file_path:
        try:
            file_data = file_storage.read_file(att.file_path)
            return {
                "file_name": att.file_name,
                "file_data": base64.b64encode(file_data).decode('utf-8'),  # 编码为 Base64 字符串
                "file_size": len(file_data),
            }
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="文件不存在")
    
    # 否则从数据库读取（向后兼容）
    return {
        "file_name": att.file_name,
        "file_data": base64.b64encode(att.file_data).decode('utf-8') if att.file_data else None,  # 编码为 Base64 字符串
        "file_size": att.file_size,
    }


@router.get("/{attachment_id}/stream")
async def stream_attachment(
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:download"))
):
    """流式下载附件（直接返回二进制文件，比 base64 更快）"""
    att, _att_source = _resolve_attachment(db, attachment_id)
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    crud_groups.enforce_attachment_content_access(db, current_user, attachment_id)

    file_path = None
    if hasattr(att, 'file_path') and att.file_path:
        full_path = file_storage.base_dir / att.file_path
        if full_path.exists():
            file_path = full_path

    if not file_path:
        raise HTTPException(status_code=404, detail="文件不存在")

    import mimetypes
    mime_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"

    return FileResponse(
        path=str(file_path),
        filename=att.file_name,
        media_type=mime_type,
    )


_ACTION_PERM = {
    "preview": "attachments:preview",
    "direct-download": "attachments:direct_download",
    "gltf": "attachments:gltf",
    "archive-tree": "attachments:archive_browse",
    "extract-file": "attachments:archive_browse",
    "office-pdf": "attachments:preview",
}


@router.get("/{attachment_id}/media-token")
async def issue_media_token(attachment_id: uuid.UUID, action: str,
                            db: Session = Depends(get_db),
                            current_user: User = Depends(get_current_active_user)):
    perm = _ACTION_PERM.get(action)
    if not perm:
        raise HTTPException(status_code=400, detail="未知媒体操作")
    if not has_permission(current_user, perm):
        raise HTTPException(status_code=403, detail="权限不足")
    crud_groups.enforce_attachment_content_access(db, current_user, attachment_id)
    return {"token": mint_media_token(str(attachment_id), action, ttl=300)}


@router.get("/{attachment_id}/direct-download")
async def direct_download_attachment(
    attachment_id: uuid.UUID,
    token: str = None,
    db: Session = Depends(get_db)
):
    """
    直接下载附件（支持 query token，用于浏览器原生下载）
    浏览器直接访问此 URL 会触发下载并显示进度
    """
    verify_media_token(token, str(attachment_id), "direct-download")

    # 获取附件
    att, _att_source = _resolve_attachment(db, attachment_id)
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")

    file_path = None
    if hasattr(att, 'file_path') and att.file_path:
        full_path = file_storage.base_dir / att.file_path
        if full_path.exists():
            file_path = full_path

    if not file_path:
        raise HTTPException(status_code=404, detail="文件不存在")

    import mimetypes
    from urllib.parse import quote
    
    mime_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
    
    # RFC 5987 编码文件名（支持中文）
    encoded_filename = quote(att.file_name)
    
    # 返回文件，带 Content-Disposition: attachment 触发下载
    return FileResponse(
        path=str(file_path),
        filename=att.file_name,
        media_type=mime_type,
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"}
    )


@router.get("/{attachment_id}/preview")
async def preview_attachment(
    attachment_id: uuid.UUID,
    token: str = None,
    db: Session = Depends(get_db)
):
    """
    预览附件（支持 query token，浏览器直接打开）
    返回 Content-Disposition: inline 让浏览器内嵌显示
    支持 Range 请求，浏览器可流式加载大文件
    """
    verify_media_token(token, str(attachment_id), "preview")

    # 获取附件
    att, _att_source = _resolve_attachment(db, attachment_id)
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")

    file_path = None
    if hasattr(att, 'file_path') and att.file_path:
        full_path = file_storage.base_dir / att.file_path
        if full_path.exists():
            file_path = full_path

    if not file_path:
        raise HTTPException(status_code=404, detail="文件不存在")

    from urllib.parse import quote

    mime_type = _preview_media_type(att.file_name)

    # RFC 5987 编码文件名（支持中文）
    encoded_filename = quote(att.file_name)
    
    # 返回文件，带 Content-Disposition: inline 让浏览器内嵌显示
    return FileResponse(
        path=str(file_path),
        filename=att.file_name,
        media_type=mime_type,
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{encoded_filename}"}
    )


@router.head("/{attachment_id}/gltf")
@router.get("/{attachment_id}/gltf")
async def get_gltf(
    attachment_id: uuid.UUID,
    token: str = None,
    db: Session = Depends(get_db),
):
    """获取 STP 对应的 glTF/glb 文件（用于前端三维预览）
    
    认证方式: ?token= JWT 查询参数（浏览器 <model-viewer> src 加载）
    
    流程:
    - 缓存存在 → 直接返回 GLB (200)
    - 缓存不存在 → 后台异步转换 + 返回 202（前端轮询重试）
    """
    verify_media_token(token, str(attachment_id), "gltf")

    att, _att_source = _resolve_attachment(db, attachment_id)
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")

    if not is_stp_file(att.file_name):
        raise HTTPException(status_code=400, detail="该附件不是 STP 文件")

    if not att.file_path:
        raise HTTPException(status_code=404, detail="附件文件路径为空")

    # 获取 glb 文件路径
    glb_path = get_gltf_path_for_attachment(str(attachment_id), att.file_path)

    if not glb_path:
        # 缓存未命中 → 后台异步转换 + 返回 202
        import asyncio
        stp_full_path = file_storage.base_dir / att.file_path
        loop = asyncio.get_event_loop()
        loop.run_in_executor(None, convert_stp_to_gltf, str(stp_full_path), str(attachment_id), att.file_path)
        return JSONResponse(
            status_code=202,
            content={
                "status": "converting",
                "message": "模型转换中，请稍后重试",
                "retry_seconds": 2
            }
        )

    return FileResponse(
        path=glb_path,
        filename=Path(att.file_name).stem + ".glb",
        media_type="model/gltf-binary",
    )


@router.get("/{attachment_id}/office-pdf")
async def get_office_pdf(
    attachment_id: uuid.UUID,
    token: str = None,
    db: Session = Depends(get_db),
):
    """获取 Office 文档转换后的 PDF（用于浏览器内嵌预览）

    认证: ?token= 媒体令牌（action=office-pdf）
    流程: 命中缓存直接返回内嵌 PDF；未命中则同步阻塞转换后返回。
    """
    verify_media_token(token, str(attachment_id), "office-pdf")

    att, _att_source = _resolve_attachment(db, attachment_id)
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")

    if not is_office_file(att.file_name):
        raise HTTPException(status_code=400, detail="该附件不是 Office 文档")

    if not att.file_path:
        raise HTTPException(status_code=404, detail="附件文件路径为空")

    src_full = file_storage.base_dir / att.file_path
    if not src_full.exists():
        raise HTTPException(status_code=404, detail="文件不存在")

    pdf_path = get_pdf_path_for_attachment(str(attachment_id), att.file_path)
    if not pdf_path:
        # 同步阻塞转换（信号量 + 120s 超时在 converter 内部）
        pdf_path = convert_office_to_pdf(str(src_full), str(attachment_id), att.file_path)
        if not pdf_path:
            raise HTTPException(status_code=500, detail="Office 文档转换失败")

    from urllib.parse import quote
    encoded_filename = quote(Path(att.file_name).stem + ".pdf")
    return FileResponse(
        path=pdf_path,
        filename=Path(att.file_name).stem + ".pdf",
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{encoded_filename}"},
    )


@router.delete("/{attachment_id}")
async def delete_attachment(
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("attachments:delete"))
):
    """删除附件"""
    att, _att_source = _resolve_attachment(db, attachment_id)
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    
    # 如果有文件路径，从文件系统删除
    if hasattr(att, 'file_path') and att.file_path:
        file_storage.delete_file(att.file_path)
    
    # 删除对应的 glb 缓存
    if is_stp_file(att.file_name):
        delete_glb_cache(str(attachment_id), att.file_path)

    # 删除对应的 PDF 缓存（Office 预览）
    if is_office_file(att.file_name):
        delete_pdf_cache(str(attachment_id), att.file_path)
    
    # 从数据库删除
    db.delete(att)
    db.commit()
    
    return {"message": "附件已删除"}


@router.get("/{attachment_id}/archive-tree")
async def get_archive_tree(
    attachment_id: uuid.UUID,
    token: str = None,
    db: Session = Depends(get_db)
):
    """
    获取压缩包内容树（ZIP / TAR / TAR.GZ）
    返回内部文件夹层级和文件列表
    """
    verify_media_token(token, str(attachment_id), "archive-tree")

    # 获取附件记录
    att = db.query(DocumentAttachment).filter(
        DocumentAttachment.id == attachment_id
    ).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")

    # 检查文件类型
    ext = Path(att.file_name).suffix.lower()
    # 特殊处理 .tar.gz
    file_path_obj = Path(att.file_name)
    suffixes = [s.lower() for s in file_path_obj.suffixes]
    is_tar_gz = suffixes == ['.tar', '.gz']

    if ext not in SUPPORTED_EXTENSIONS and not is_tar_gz:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的压缩格式: {ext}，仅支持 ZIP / TAR / TAR.GZ"
        )

    # 定位文件
    file_path = None
    if hasattr(att, 'file_path') and att.file_path:
        full_path = file_storage.base_dir / att.file_path
        if full_path.exists():
            file_path = full_path

    if not file_path:
        raise HTTPException(status_code=404, detail="文件不存在")

    # 读取压缩包内容
    try:
        result = read_archive_tree(str(file_path))
    except (zipfile.BadZipFile, tarfile.ReadError) as e:
        raise HTTPException(status_code=500, detail=f"压缩包读取失败: {str(e)}")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "file_name": att.file_name,
        **result
    }


@router.get("/{attachment_id}/extract-file")
async def extract_archive_file(
    attachment_id: uuid.UUID,
    path: str,
    token: str = None,
    disposition: str = "attachment",
    db: Session = Depends(get_db)
):
    """从压缩包中提取单个文件并返回"""
    verify_media_token(token, str(attachment_id), "extract-file")

    att, _att_source = _resolve_attachment(db, attachment_id)
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")

    ext = Path(att.file_name).suffix.lower()
    suffixes = [s.lower() for s in Path(att.file_name).suffixes]
    if ext not in SUPPORTED_EXTENSIONS and suffixes != ['.tar', '.gz']:
        raise HTTPException(status_code=400, detail="非压缩包文件")

    file_path = None
    if hasattr(att, 'file_path') and att.file_path:
        full_path = file_storage.base_dir / att.file_path
        if full_path.exists():
            file_path = full_path
    if not file_path:
        raise HTTPException(status_code=404, detail="文件不存在")

    try:
        extracted_path = extract_file(str(file_path), path)
    except KeyError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"提取失败: {str(e)}")

    import mimetypes
    from urllib.parse import quote
    mime_type = mimetypes.guess_type(extracted_path)[0] or "application/octet-stream"
    filename = Path(extracted_path).name
    encoded = quote(filename)

    headers = {"Content-Disposition": f"{disposition}; filename*=UTF-8''{encoded}"}
    return FileResponse(path=extracted_path, filename=filename, media_type=mime_type, headers=headers)
