"""AI 助手 Agent 编排循环。"""
import json
import os
from typing import Callable, Optional

from sqlalchemy.orm import Session

from ..models import User
from . import tools as tools_mod
from .sanitizer import sanitize_for_llm

SYSTEM_PROMPT = (
    "你是 PDM/BOM 系统的智能助手。可调用工具获取零件、部件、BOM 数据，"
    "然后用中文为用户做分析、对比、撰写文档。无法用工具获取的信息不要编造。"
    "涉及下载时，把工具返回的下载链接如实告知用户。"
)


def run_agent(messages: list, db: Session, user: User, emit: Callable[[dict], None],
              llm=None, max_iters: Optional[int] = None) -> None:
    if llm is None:
        from .llm_client import LLMClient
        llm = LLMClient()
    if max_iters is None:
        max_iters = int(os.getenv("ASSISTANT_MAX_ITERS", "8"))

    tool_specs = [t["schema"] for t in tools_mod.REGISTRY.values()]
    convo = [{"role": "system", "content": SYSTEM_PROMPT}] + list(messages)

    for _ in range(max_iters):
        text_buf = ""
        final = None
        for ev in llm.stream_chat(convo, tool_specs):
            if ev["type"] == "text":
                text_buf += ev["delta"]
                emit({"type": "token", "delta": ev["delta"]})
            elif ev["type"] == "final":
                final = ev

        tool_calls = (final or {}).get("tool_calls") or []
        if not tool_calls:
            emit({"type": "done"})
            return

        # 记录助手的 tool_calls 轮
        convo.append({"role": "assistant", "content": text_buf or None,
                      "tool_calls": tool_calls})

        for tc in tool_calls:
            name = tc["function"]["name"]
            try:
                args = json.loads(tc["function"]["arguments"] or "{}")
            except json.JSONDecodeError:
                args = {}
            emit({"type": "tool_start", "name": name,
                  "summary": json.dumps(args, ensure_ascii=False)[:80]})
            spec = tools_mod.REGISTRY.get(name)
            if not spec:
                result = {"error": f"未知工具 {name}"}
            else:
                try:
                    result = spec["execute"](db, user, **args)
                except Exception as exc:  # 工具错误回灌模型，不中断
                    result = {"error": str(exc)}
            card = result.pop("_card", None) if isinstance(result, dict) else None
            emit({"type": "tool_end", "name": name, "ok": "error" not in (result or {})})
            if card:
                emit({"type": "card", "card_type": card["card_type"],
                      "payload": card["payload"]})
            convo.append({"role": "tool", "tool_call_id": tc["id"],
                          "content": json.dumps(sanitize_for_llm(result),
                                                ensure_ascii=False)})

    emit({"type": "error", "message": "已达到最大工具调用轮数，请缩小问题范围后重试。"})
