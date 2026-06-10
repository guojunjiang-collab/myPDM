import json
import uuid
from app.assistant import agent
from app import models


def _emit_collector():
    events = []
    return events, lambda ev: events.append(ev)


def _make_part(db, code, name):
    p = models.Part(id=uuid.uuid4(), code=code, name=name, status="active")
    db.add(p); db.commit(); db.refresh(p)
    return p


def test_agent_plain_answer_emits_token_and_done(db, engineer_user, make_fake_llm):
    llm = make_fake_llm([[
        {"type": "text", "delta": "你好"},
        {"type": "final", "finish_reason": "stop", "tool_calls": []},
    ]])
    events, emit = _emit_collector()
    agent.run_agent([{"role": "user", "content": "hi"}], db, engineer_user, emit,
                    llm=llm, max_iters=5)
    types = [e["type"] for e in events]
    assert "token" in types and types[-1] == "done"


def test_agent_runs_tool_then_answers(db, engineer_user, make_fake_llm):
    _make_part(db, "P-100", "螺钉")
    tool_call = {"id": "c1", "type": "function",
                 "function": {"name": "search_entity",
                              "arguments": json.dumps({"keyword": "P-100"})}}
    llm = make_fake_llm([
        [{"type": "final", "finish_reason": "tool_calls", "tool_calls": [tool_call]}],
        [{"type": "text", "delta": "找到了 P-100"},
         {"type": "final", "finish_reason": "stop", "tool_calls": []}],
    ])
    events, emit = _emit_collector()
    agent.run_agent([{"role": "user", "content": "搜 P-100"}], db, engineer_user, emit,
                    llm=llm, max_iters=5)
    types = [e["type"] for e in events]
    assert "tool_start" in types and "tool_end" in types
    # search_entity 不产卡片；get_bom_tree 才产。此处确保循环结束
    assert types[-1] == "done"


def test_agent_stops_at_max_iters(db, engineer_user, make_fake_llm):
    tool_call = {"id": "c1", "type": "function",
                 "function": {"name": "search_entity",
                              "arguments": json.dumps({"keyword": "x"})}}
    # 永远返回 tool_calls，触发上限
    llm = make_fake_llm([[{"type": "final", "finish_reason": "tool_calls",
                           "tool_calls": [tool_call]}]] * 10)
    events, emit = _emit_collector()
    agent.run_agent([{"role": "user", "content": "loop"}], db, engineer_user, emit,
                    llm=llm, max_iters=3)
    assert events[-1]["type"] == "error"
