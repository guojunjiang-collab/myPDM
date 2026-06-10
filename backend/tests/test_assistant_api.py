import json
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_db
from app.routers.auth import get_current_active_user, oauth2_scheme
from app.assistant import agent as agent_mod


def test_chat_streams_events(db, engineer_user, monkeypatch):
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: engineer_user
    app.dependency_overrides[oauth2_scheme] = lambda: "test-token"

    def fake_run_agent(messages, db_, user, emit, **kw):
        emit({"type": "token", "delta": "hi"})
        emit({"type": "done"})
    monkeypatch.setattr(agent_mod, "run_agent", fake_run_agent)

    client = TestClient(app)
    with client.stream("POST", "/api/assistant/chat",
                       json={"messages": [{"role": "user", "content": "hi"}]}) as resp:
        assert resp.status_code == 200
        body = "".join(resp.iter_text())
    assert '"type": "token"' in body or '"type":"token"' in body
    assert "done" in body
    app.dependency_overrides.clear()


def test_artifact_download(db, engineer_user, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    from app.assistant import document_builder
    meta = document_builder.build_document("t", "# 标题\n正文", "md")

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_active_user] = lambda: engineer_user
    client = TestClient(app)
    resp = client.get(f"/api/assistant/artifacts/{meta['doc_id']}/download")
    assert resp.status_code == 200
    assert "正文" in resp.text
    app.dependency_overrides.clear()
