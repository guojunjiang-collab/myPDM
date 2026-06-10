from app.assistant.llm_client import accumulate_tool_calls


def test_accumulate_tool_calls_merges_fragments():
    # 模拟 OpenAI 流式 tool_call 分片
    frags = [
        [{"index": 0, "id": "c1", "function": {"name": "search_entity", "arguments": '{"key'}}],
        [{"index": 0, "function": {"arguments": 'word":"P-1"}'}}],
    ]
    acc = {}
    for fr in frags:
        accumulate_tool_calls(acc, fr)
    calls = list(acc.values())
    assert calls[0]["id"] == "c1"
    assert calls[0]["function"]["name"] == "search_entity"
    assert calls[0]["function"]["arguments"] == '{"keyword":"P-1"}'
