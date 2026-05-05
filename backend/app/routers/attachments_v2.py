"""
附件管理路由 - 支持文件系统存储和分块上传
"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session
import uuid
import os
import logging
import asyncio
from pathlib import Path

from ..database import get_db
from ..models import User, DocumentAttachment, Document
from ..file_storage import file_storage, chunked_uploader, MAX_FILE_SIZE, CHUNK_SIZE
from .auth import require_role
from ..stp_converter import is_stp_file, convert_stp_to_gltf

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/attachments", tags=["附件管理"])


def _attachment_response(att):
    return {
        "id": att.id,
        "file_name": att.file_name,
        "file_size": att.file_size,
        "file_path": att.file_path,
        "created_at": att.created_at,
        "updated_at": att.updated_at,
    }


@router.get("/")
async def list_attachments(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    """获取附件列表"""
    attachments = db.query(DocumentAttachment).all()
    return [_attachment_response(a) for a in attachments]


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    entity_type: str = Form("document"),
    entity_id: str = Form(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
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
        # 如果是图文档，先删除旧附件
        if entity_type == "document":
            doc = db.query(Document).filter(Document.id == uuid.UUID(entity_id)).first()
            if doc and doc.file_id:
                # 查询旧附件记录
                old_att = db.query(DocumentAttachment).filter(DocumentAttachment.id == doc.file_id).first()
                if old_att:
                    # 删除文件系统中的旧文件
                    if hasattr(old_att, 'file_path') and old_att.file_path:
                        try:
                            file_storage.delete_file(old_att.file_path)
                        except Exception as e:
                            print(f"[WARNING] Failed to delete old file {old_att.file_path}: {e}")
                    # 删除数据库中的旧附件记录
                    db.delete(old_att)
        
        # 保存文件到文件系统
        result = file_storage.save_file(
            file_data,
            entity_type,
            entity_id,
            file.filename or "unnamed"
        )
        
        # 创建数据库记录
        att_id = str(uuid.uuid4())
        new_att = DocumentAttachment(
            id=att_id,
            document_id=uuid.UUID(entity_id) if entity_type == "document" else None,
            file_name=result["filename"],
            file_data=None,  # 不再存储在数据库
            file_size=result["file_size"],
            file_path=result["file_path"],  # 保存文件路径
            file_hash=result.get("file_hash", ""),  # 保存文件哈希
        )
        
        db.add(new_att)
        db.flush()  # 先刷新到数据库，确保记录被创建
        
        # 如果是图文档，更新 documents 表的 file_name 和 file_id
        if entity_type == "document":
            doc = db.query(Document).filter(Document.id == uuid.UUID(entity_id)).first()
            if doc:
                doc.file_name = result["filename"]
                doc.file_id = uuid.UUID(att_id)
        
        db.commit()
        db.refresh(new_att)
        
        # 异步转换 STP → glTF（不阻塞上传响应）
        if is_stp_file(result["filename"]):
            full_path = file_storage.base_dir / result["file_path"]
            asyncio.get_event_loop().run_in_executor(
                None, convert_stp_to_gltf, str(full_path)
            )
        
        return {
            "id": new_att.id,
            "file_name": result["filename"],
            "file_size": result["file_size"],
            "file_path": result["file_path"],
            "message": "文件上传成功",
        }
        
    except HTTPException:
        raise  # 重新抛出 HTTPException
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
    current_user: User = Depends(require_role(["admin", "engineer"]))
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
        meta = chunked_uploader.init_upload(
            filename,
            file_size,
            entity_type,
            entity_id,
            total_chunks
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
    current_user: User = Depends(require_role(["admin", "engineer"]))
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
    current_user: User = Depends(require_role(["admin", "engineer"]))
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
        
        # 如果是图文档，先删除旧附件
        if file_info["entity_type"] == "document":
            doc = db.query(Document).filter(Document.id == uuid.UUID(file_info["entity_id"])).first()
            if doc and doc.file_id:
                # 查询旧附件记录
                old_att = db.query(DocumentAttachment).filter(DocumentAttachment.id == doc.file_id).first()
                if old_att:
                    # 删除文件系统中的旧文件
                    if hasattr(old_att, 'file_path') and old_att.file_path:
                        try:
                            file_storage.delete_file(old_att.file_path)
                        except Exception as e:
                            print(f"[WARNING] Failed to delete old file {old_att.file_path}: {e}")
                    # 删除数据库中的旧附件记录
                    db.delete(old_att)
        
        # 创建数据库记录
        att_id = str(uuid.uuid4())
        new_att = DocumentAttachment(
            id=att_id,
            document_id=uuid.UUID(file_info["entity_id"]) if file_info["entity_type"] == "document" else None,
            file_name=file_info["filename"],
            file_data=None,  # 不再存储在数据库
            file_size=file_info["file_size"],
            file_path=file_info["file_path"],  # 保存文件路径
            file_hash=file_info.get("file_hash", ""),  # 保存文件哈希
        )
        
        db.add(new_att)
        db.flush()  # 先刷新到数据库，确保记录被创建
        
        # 如果是图文档，更新 documents 表的 file_name 和 file_id
        print(f"[DEBUG] entity_type: {file_info['entity_type']}, entity_id: {file_info['entity_id']}")
        if file_info["entity_type"] == "document":
            doc = db.query(Document).filter(Document.id == uuid.UUID(file_info["entity_id"])).first()
            print(f"[DEBUG] doc query result: {doc}")
            if doc:
                doc.file_name = file_info["filename"]
                doc.file_id = uuid.UUID(att_id)
                print(f"[DEBUG] Updated doc: file_name={doc.file_name}, file_id={doc.file_id}")
        
        db.commit()
        db.refresh(new_att)
        
        # 异步转换 STP → glTF
        if is_stp_file(file_info["filename"]):
            full_path = file_storage.base_dir / file_info["file_path"]
            asyncio.get_event_loop().run_in_executor(
                None, convert_stp_to_gltf, str(full_path)
            )
        
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
    current_user: User = Depends(require_role(["admin", "engineer"]))
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
    current_user: User = Depends(require_role(["admin", "engineer"]))
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


@router.get("/{attachment_id}")
async def get_attachment(
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    """获取单个附件信息"""
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    
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
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    """下载附件"""
    import base64
    
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    
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
    current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
):
    """流式下载附件（直接返回二进制文件，比 base64 更快）"""
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == attachment_id).first()
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
    mime_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"

    return FileResponse(
        path=str(file_path),
        filename=att.file_name,
        media_type=mime_type,
    )


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
    from jose import JWTError, jwt
    from .auth import SECRET_KEY, ALGORITHM
    
    # 验证 token
    if not token:
        raise HTTPException(status_code=401, detail="缺少认证令牌")
    
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        if not username:
            raise HTTPException(status_code=401, detail="无效的认证令牌")
    except JWTError:
        raise HTTPException(status_code=401, detail="认证令牌验证失败")
    
    # 获取附件
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == attachment_id).first()
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
    mime_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"

    # 返回文件，带 Content-Disposition: attachment 触发下载
    return FileResponse(
        path=str(file_path),
        filename=att.file_name,
        media_type=mime_type,
        headers={"Content-Disposition": f'attachment; filename="{att.file_name}"'}
    )


@router.get("/{attachment_id}/gltf")
async def get_gltf(
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer", "production", "guest"]))
):
    """获取 STP 对应的 glTF/glb 文件（用于前端三维预览）"""
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")

    if not is_stp_file(att.file_name):
        raise HTTPException(status_code=400, detail="该附件不是 STP 文件")

    if not att.file_path:
        raise HTTPException(status_code=404, detail="附件文件路径为空")

    stp_full_path = file_storage.base_dir / att.file_path

    # 尝试获取已转换的 glb 文件
    from ..stp_converter import get_gltf_path
    glb_path = get_gltf_path(str(stp_full_path))

    if not glb_path:
        # 触发转换
        glb_path = convert_stp_to_gltf(str(stp_full_path))

    if not glb_path:
        raise HTTPException(status_code=500, detail="STP 文件转换失败，请稍后重试")

    return FileResponse(
        path=glb_path,
        filename=Path(att.file_name).stem + ".glb",
        media_type="model/gltf-binary",
    )


@router.delete("/{attachment_id}")
async def delete_attachment(
    attachment_id: uuid.UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(["admin", "engineer"]))
):
    """删除附件"""
    att = db.query(DocumentAttachment).filter(DocumentAttachment.id == attachment_id).first()
    if not att:
        raise HTTPException(status_code=404, detail="附件不存在")
    
    # 如果有文件路径，从文件系统删除
    if hasattr(att, 'file_path') and att.file_path:
        file_storage.delete_file(att.file_path)
    
    # 从数据库删除
    db.delete(att)
    db.commit()
    
    return {"message": "附件已删除"}
