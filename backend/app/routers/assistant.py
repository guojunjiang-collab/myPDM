"""AI 助手 SSE 端点。"""
import json
import queue
import threading

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_db, SessionLocal
from ..models import User
from .auth import require_role, get_current_active_user
from ..assistant import agent as agent_mod
from ..assistant import document_builder

router = APIRouter(prefix="/assistant", tags=["AI助手"])

ASSISTANT_ROLES = ["admin", "engineer", "production", "guest"]


class ChatRequest(BaseModel):
    messages: list


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/chat")
async def chat(
    req: ChatRequest,
    current_user: User = Depends(require_role(ASSISTANT_ROLES)),
):
    """SSE 流式：在独立线程跑 Agent，通过队列把事件推给响应生成器。

    Agent 内部需要 DB 会话——为避免跨线程复用请求级会话，这里新开一个会话。
    """
    q: "queue.Queue" = queue.Queue()
    SENTINEL = object()

    def worker():
        db = SessionLocal()
        try:
            agent_mod.run_agent(req.messages, db, current_user, q.put)
        except Exception as exc:  # 兜底
            q.put({"type": "error", "message": str(exc)})
        finally:
            db.close()
            q.put(SENTINEL)

    threading.Thread(target=worker, daemon=True).start()

    def stream():
        while True:
            ev = q.get()
            if ev is SENTINEL:
                break
            yield _sse(ev)

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.get("/artifacts/{doc_id}/download")
async def download_artifact(
    doc_id: str,
    current_user: User = Depends(require_role(ASSISTANT_ROLES)),
):
    content = document_builder.read_document(doc_id)
    if content is None:
        raise HTTPException(status_code=404, detail="产物不存在")
    return StreamingResponse(
        iter([content]), media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{doc_id}.md"'})
