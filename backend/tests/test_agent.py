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


def test_agent_injects_token_into_needs_token_tool(db, engineer_user, make_fake_llm, monkeypatch):
    captured = {}
    def fake_exec(db_, user, _token=None, **kw):
        captured["token"] = _token
        captured["kw"] = kw
        return {"ok": True}
    # 临时往 REGISTRY 注入一个 needs_token 工具
    from app.assistant import tools as tools_mod
    tools_mod.REGISTRY["__probe__"] = {"execute": fake_exec, "needs_token": True,
        "schema": {"type": "function", "function": {"name": "__probe__",
            "parameters": {"type": "object", "properties": {}}}}}
    try:
        tc = {"id": "c1", "type": "function",
              "function": {"name": "__probe__", "arguments": "{}"}}
        llm = make_fake_llm([
            [{"type": "final", "finish_reason": "tool_calls", "tool_calls": [tc]}],
            [{"type": "text", "delta": "ok"},
             {"type": "final", "finish_reason": "stop", "tool_calls": []}],
        ])
        events, emit = _emit_collector()
        agent.run_agent([{"role": "user", "content": "x"}], db, engineer_user, emit,
                        token="tok-xyz", llm=llm, max_iters=5)
        assert captured["token"] == "tok-xyz"
    finally:
        tools_mod.REGISTRY.pop("__probe__", None)


def test_system_prompt_includes_pdm_overview():
    from app.assistant import agent as agent_mod
    assert "构型" in agent_mod.SYSTEM_PROMPT
    assert "list_api_endpoints" in agent_mod.SYSTEM_PROMPT


def test_system_message_includes_role_and_capability(db, guest_user, make_fake_llm):
    llm = make_fake_llm([[{"type": "text", "delta": "hi"},
                          {"type": "final", "finish_reason": "stop", "tool_calls": []}]])
    events, emit = _emit_collector()
    agent.run_agent([{"role": "user", "content": "hi"}], db, guest_user, emit, llm=llm)
    sys_msg = llm.calls[0]["messages"][0]["content"]
    assert "guest" in sys_msg
    assert "不可下载" in sys_msg


def test_system_message_role_for_engineer(db, engineer_user, make_fake_llm):
    llm = make_fake_llm([[{"type": "text", "delta": "hi"},
                          {"type": "final", "finish_reason": "stop", "tool_calls": []}]])
    events, emit = _emit_collector()
    agent.run_agent([{"role": "user", "content": "hi"}], db, engineer_user, emit, llm=llm)
    sys_msg = llm.calls[0]["messages"][0]["content"]
    assert "engineer" in sys_msg


def test_system_prompt_directs_download_buttons_not_urls():
    from app.assistant import agent as agent_mod
    # 应指引用工具生成下载按钮，且不再指示"把下载链接如实告知用户"
    assert "download_document" in agent_mod.SYSTEM_PROMPT
    assert "如实告知" not in agent_mod.SYSTEM_PROMPT


def test_system_prompt_mentions_attachment_content_reading():
    from app.assistant import agent as agent_mod
    assert "read_attachment_content" in agent_mod.SYSTEM_PROMPT


def test_system_prompt_enforces_data_grounding():
    from app.assistant import agent as agent_mod
    p = agent_mod.SYSTEM_PROMPT
    assert "仅基于" in p
    assert "不得联网" in p or "不得联网检索" in p
    assert "系统中未找到相关数据" in p


def test_strip_comments_removes_html_comments():
    from app.assistant import agent as agent_mod
    out = agent_mod._strip_comments("前<!-- 编辑说明\n多行 -->后")
    assert "编辑说明" not in out
    assert "前" in out and "后" in out


def test_load_base_prompt_falls_back_when_missing(tmp_path):
    from app.assistant import agent as agent_mod
    missing = str(tmp_path / "nope.md")
    assert agent_mod.load_base_prompt(missing) == agent_mod.DEFAULT_SYSTEM_PROMPT


def test_load_base_prompt_reads_file(tmp_path):
    from app.assistant import agent as agent_mod
    f = tmp_path / "p.md"
    f.write_text("<!-- 说明 -->\n自定义提示词内容", encoding="utf-8")
    out = agent_mod.load_base_prompt(str(f))
    assert out == "自定义提示词内容"


def test_system_prompt_loaded_from_md_file():
    # 内置 system_prompt.md 应被加载，仍含接地约束关键词
    from app.assistant import agent as agent_mod
    assert "仅基于" in agent_mod.SYSTEM_PROMPT


def test_system_prompt_requires_comprehensive_search():
    from app.assistant import agent as agent_mod
    p = agent_mod.SYSTEM_PROMPT
    assert "全面检索" in p
    # 报告类请求需读附件正文、取完整字段
    assert "read_attachment_content" in p


def test_system_message_includes_skill_catalog(db, engineer_user, make_fake_llm):
    llm = make_fake_llm([[{"type": "text", "delta": "hi"},
                          {"type": "final", "finish_reason": "stop", "tool_calls": []}]])
    events, emit = _emit_collector()
    agent.run_agent([{"role": "user", "content": "hi"}], db, engineer_user, emit, llm=llm)
    sys_msg = llm.calls[0]["messages"][0]["content"]
    assert "可用技能" in sys_msg
    assert "project_summary_report" in sys_msg  # engineer 可见
