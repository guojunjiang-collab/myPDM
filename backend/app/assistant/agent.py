"""AI 助手 Agent 编排循环。"""
import json
import os
from typing import Callable, Optional

from sqlalchemy.orm import Session

from ..models import User
from . import tools as tools_mod
from . import knowledge
from .knowledge_glossary import ROLE_CAPABILITIES
from .sanitizer import sanitize_for_llm

# 内置默认提示词——仅当外置 system_prompt.md 缺失/为空时兜底，保证不崩
DEFAULT_SYSTEM_PROMPT = (
    "你是 PDM/BOM 系统的智能助手。可调用工具获取零件、部件、BOM 数据，"
    "然后用中文为用户做分析、对比、撰写文档。"
    "【信息接地约束】你的所有回答与分析必须仅基于通过工具检索到的本系统数据（含附件正文）；"
    "不得使用训练知识或常识引入系统外的事实，不得联网检索，"
    "不得臆测或编造未检索到的数值、结论与信息。"
    "可对已检索到的数据做归纳、对比、总结，但不得超出数据本身。"
    "若系统中没有相关数据或未能获取，必须明确告知用户『系统中未找到相关数据』并停止，不要猜测或填补。"
    "涉及附件/文档下载时，必须调用 download_document 工具为每个附件生成下载按钮，"
    "不要在回复正文里手写下载链接或 URL（手写链接缺少鉴权、无法下载）；"
    "正文可按文件名列出清单，下载入口由按钮提供。"
    "需要分析附件内容（pdf/word/excel/文本）时，先经文档接口取得 attachment_id，"
    "再调用 read_attachment_content 读取正文后总结分析。"
)

# 外置可编辑提示词文件（与本模块同目录），编辑后重启后端生效
_PROMPT_FILE = os.path.join(os.path.dirname(__file__), "system_prompt.md")


def _strip_comments(text: str) -> str:
    """移除 <!-- ... --> HTML 注释块（供编辑者写说明，不发给模型）。"""
    import re
    return re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL)


def load_base_prompt(path: str = _PROMPT_FILE) -> str:
    """加载外置提示词；缺失/为空则回退内置默认。"""
    try:
        with open(path, encoding="utf-8") as f:
            content = _strip_comments(f.read()).strip()
        return content or DEFAULT_SYSTEM_PROMPT
    except (FileNotFoundError, OSError):
        return DEFAULT_SYSTEM_PROMPT


SYSTEM_PROMPT = load_base_prompt() + "\n\n" + knowledge.build_overview()


def run_agent(messages: list, db: Session, user: User, emit: Callable[[dict], None],
              token: Optional[str] = None, llm=None, max_iters: Optional[int] = None) -> None:
    if llm is None:
        from .llm_client import LLMClient
        llm = LLMClient()
    if max_iters is None:
        max_iters = int(os.getenv("ASSISTANT_MAX_ITERS", "8"))

    tool_specs = [t["schema"] for t in tools_mod.REGISTRY.values()]
    role = getattr(user, "role", None) or "guest"
    cap = ROLE_CAPABILITIES.get(role, "按你的权限提供只读操作")
    role_line = (f"\n\n当前用户角色：{role}（{cap}）。"
                 "只提供该角色权限范围内的读取操作；遇到无权限的操作，礼貌说明而非尝试。")
    convo = [{"role": "system", "content": SYSTEM_PROMPT + role_line}] + list(messages)

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
                kwargs = dict(args)
                if spec.get("needs_token"):
                    kwargs["_token"] = token
                try:
                    result = spec["execute"](db, user, **kwargs)
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
