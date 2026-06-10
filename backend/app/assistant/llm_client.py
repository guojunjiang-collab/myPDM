"""DeepSeek（OpenAI 兼容）流式客户端封装。

stream_chat 产出统一事件：
  {"type": "text", "delta": str}
  {"type": "final", "finish_reason": str, "tool_calls": list}
便于 agent 消费与测试 mock。
"""
import os
from typing import Iterator, Optional


def accumulate_tool_calls(acc: dict, fragments: list) -> None:
    """把流式 tool_call 分片按 index 累积进 acc。"""
    for f in fragments:
        idx = f["index"]
        slot = acc.setdefault(idx, {"id": None, "type": "function",
                                    "function": {"name": "", "arguments": ""}})
        if f.get("id"):
            slot["id"] = f["id"]
        fn = f.get("function") or {}
        if fn.get("name"):
            slot["function"]["name"] += fn["name"]
        if fn.get("arguments"):
            slot["function"]["arguments"] += fn["arguments"]


class LLMClient:
    def __init__(self, client=None, model: Optional[str] = None):
        self._model = model or os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
        if client is not None:
            self._client = client
        else:
            from openai import OpenAI
            self._client = OpenAI(
                api_key=os.getenv("DEEPSEEK_API_KEY", ""),
                base_url=os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com"),
            )

    def stream_chat(self, messages: list, tools: list) -> Iterator[dict]:
        stream = self._client.chat.completions.create(
            model=self._model, messages=messages, tools=tools or None,
            stream=True,
        )
        acc: dict = {}
        finish = None
        for chunk in stream:
            choice = chunk.choices[0]
            delta = choice.delta
            if getattr(delta, "content", None):
                yield {"type": "text", "delta": delta.content}
            if getattr(delta, "tool_calls", None):
                frags = [{
                    "index": tc.index, "id": tc.id,
                    "function": {"name": tc.function.name if tc.function else None,
                                 "arguments": tc.function.arguments if tc.function else None},
                } for tc in delta.tool_calls]
                accumulate_tool_calls(acc, frags)
            if choice.finish_reason:
                finish = choice.finish_reason
        yield {"type": "final", "finish_reason": finish,
               "tool_calls": [acc[k] for k in sorted(acc)]}
