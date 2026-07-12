import uuid
from app.assistant import tools
from app import models
from app import models_parts


def _make_master(db, code, name, mtype="part"):
    """创建 PartMaster + 一个 draft 版本 + 当前迭代，返回 (master, revision, iteration)。"""
    master = models_parts.PartMaster(id=uuid.uuid4(), code=code, name=name, type=mtype)
    db.add(master); db.commit(); db.refresh(master)
    rev = models_parts.PartRevision(
        id=uuid.uuid4(), master_id=master.id, version="A", status="draft",
        latest_iteration=1,
    )
    db.add(rev); db.commit(); db.refresh(rev)
    it = models_parts.PartIteration(id=uuid.uuid4(), revision_id=rev.id, iteration=1)
    db.add(it); db.commit(); db.refresh(it)
    return master, rev, it


def _make_part(db, code, name):
    master, _, _ = _make_master(db, code, name, "part")
    return master


def _make_assembly(db, code, name):
    master, _, _ = _make_master(db, code, name, "assembly")
    return master


def _link_bom(db, parent, child, quantity=1):
    """在 parent 的当前迭代下挂 child（均为 master），建立一条 BOM 关系。"""
    prev = db.query(models_parts.PartRevision).filter(
        models_parts.PartRevision.master_id == parent.id).first()
    pit = db.query(models_parts.PartIteration).filter(
        models_parts.PartIteration.revision_id == prev.id).first()
    crev = db.query(models_parts.PartRevision).filter(
        models_parts.PartRevision.master_id == child.id).first()
    bi = models.BOMItem(
        id=uuid.uuid4(), iteration_id=pit.id,
        parent_revision_id=prev.id, child_revision_id=crev.id, quantity=quantity,
    )
    db.add(bi); db.commit()
    return bi


def test_search_entity_matches_part_by_code(db, engineer_user):
    _make_part(db, "P-100", "螺钉")
    out = tools.REGISTRY["search_entity"]["execute"](db, engineer_user, keyword="P-100")
    assert any(r["code"] == "P-100" and r["type"] == "component" for r in out["results"])


def test_search_entity_empty_keyword_returns_empty(db, engineer_user):
    out = tools.REGISTRY["search_entity"]["execute"](db, engineer_user, keyword="")
    assert out["results"] == []


def test_registry_specs_have_required_openai_shape():
    for name, spec in tools.REGISTRY.items():
        s = spec["schema"]
        assert s["type"] == "function"
        assert s["function"]["name"] == name
        assert "parameters" in s["function"]


def test_get_part_detail_returns_brief(db, engineer_user):
    p = _make_part(db, "P-1", "零件")
    out = tools.REGISTRY["get_part_detail"]["execute"](db, engineer_user, part_id=str(p.id))
    assert out["detail"]["code"] == "P-1"


def test_get_bom_tree_returns_children(db, engineer_user):
    parent = _make_assembly(db, "A-P", "父")
    child = _make_part(db, "P-C", "子")
    _link_bom(db, parent, child, quantity=3)
    out = tools.REGISTRY["get_bom_tree"]["execute"](
        db, engineer_user, type="assembly", id=str(parent.id))
    codes = {r["child_code"] for r in out["items"]}
    assert "P-C" in codes
    assert out["_card"]["card_type"] == "table"


def _fake_node(code, qty, level=0):
    return {"child_code": code, "child_name": code + "名", "quantity": qty, "level": level}


def test_diff_bom_small_returns_raw_trees(db, engineer_user, monkeypatch):
    left = _make_assembly(db, "A-1", "左")
    right = _make_assembly(db, "A-2", "右")
    monkeypatch.setattr(tools.compare, "get_bom_tree_recursive",
                        lambda d, eid, **k: [_fake_node("X", 1)])
    out = tools.REGISTRY["diff_bom"]["execute"](
        db, engineer_user, left_id=str(left.id), right_id=str(right.id))
    assert out["mode"] == "raw"
    assert "left" in out and "right" in out


def test_diff_bom_large_returns_preprocessed_diff(db, engineer_user, monkeypatch):
    left = _make_assembly(db, "A-1", "左")
    right = _make_assembly(db, "A-2", "右")
    # 阈值设小，强制走预处理；左右有增/删/改量
    monkeypatch.setenv("ASSISTANT_BOM_RAW_THRESHOLD", "1")
    left_nodes = [_fake_node("COMMON", 1), _fake_node("ONLY_LEFT", 1)]
    right_nodes = [_fake_node("COMMON", 3), _fake_node("ONLY_RIGHT", 1)]
    calls = iter([left_nodes, right_nodes])
    monkeypatch.setattr(tools.compare, "get_bom_tree_recursive",
                        lambda d, eid, **k: next(calls))
    out = tools.REGISTRY["diff_bom"]["execute"](
        db, engineer_user, left_id=str(left.id), right_id=str(right.id))
    assert out["mode"] == "preprocessed"
    codes_added = {r["code"] for r in out["diff"]["added"]}
    codes_removed = {r["code"] for r in out["diff"]["removed"]}
    codes_changed = {r["code"] for r in out["diff"]["changed"]}
    assert "ONLY_RIGHT" in codes_added
    assert "ONLY_LEFT" in codes_removed
    assert "COMMON" in codes_changed
    assert out["_card"]["card_type"] == "table"


def test_trace_bom_returns_parents(db, engineer_user):
    parent = _make_assembly(db, "A-P", "父")
    child = _make_part(db, "P-C", "子")
    _link_bom(db, parent, child, quantity=2)
    out = tools.REGISTRY["trace_bom"]["execute"](
        db, engineer_user, entity_type="component", entity_id=str(child.id))
    assert isinstance(out["parents"], list)
    assert any(p["code"] == "A-P" for p in out["parents"])


def test_export_bom_returns_link_for_engineer(db, engineer_user):
    a = _make_assembly(db, "A-X", "导出")
    out = tools.REGISTRY["export_bom"]["execute"](
        db, engineer_user, type="assembly", id=str(a.id))
    assert out["_card"]["card_type"] == "download"
    assert "/api/" in out["_card"]["payload"]["url"]


def test_export_bom_denied_for_guest(db, guest_user):
    a = _make_assembly(db, "A-Y", "禁止")
    out = tools.REGISTRY["export_bom"]["execute"](
        db, guest_user, type="assembly", id=str(a.id))
    assert "error" in out and "_card" not in out


def test_create_document_returns_markdown_doc_card(db, engineer_user, tmp_path, monkeypatch):
    monkeypatch.setenv("UPLOAD_DIR", str(tmp_path))
    out = tools.REGISTRY["create_document"]["execute"](
        db, engineer_user, title="对比报告", content="# 报告\n内容")
    assert out["_card"]["card_type"] == "markdown_doc"
    assert out["_card"]["payload"]["download_url"].endswith("/download")


def test_list_api_endpoints_registered_and_returns_endpoints(db, engineer_user):
    out = tools.REGISTRY["list_api_endpoints"]["execute"](db, engineer_user)
    assert "endpoints" in out
    paths = {e["path"] for e in out["endpoints"]}
    # 至少包含零件列表，且不含用户接口
    assert any(p.startswith("/api/parts") for p in paths)
    assert not any(p.startswith("/api/users") for p in paths)


def test_get_data_dictionary_tool_registered(db, engineer_user):
    out = tools.REGISTRY["get_data_dictionary"]["execute"](db, engineer_user, entity="part")
    assert out["entity"] == "part"
    assert any(f["name"] == "code" for f in out["fields"])


def test_list_api_endpoints_filtered_by_role(db, guest_user, engineer_user):
    g = {e["path"] for e in
         tools.REGISTRY["list_api_endpoints"]["execute"](db, guest_user)["endpoints"]}
    e = {e["path"] for e in
         tools.REGISTRY["list_api_endpoints"]["execute"](db, engineer_user)["endpoints"]}
    assert g <= e  # guest 目录是 engineer 的子集
    # bom/tree 不含 guest，故仅 engineer 可见
    assert "/api/bom/tree/{item_type}/{item_id}" in e
    assert "/api/bom/tree/{item_type}/{item_id}" not in g


def test_download_document_label_includes_filename(db, engineer_user):
    att = models.DocumentAttachment(id=uuid.uuid4(), document_id=uuid.uuid4(),
                                    file_name="图纸A.pdf")
    db.add(att); db.commit()
    out = tools.REGISTRY["download_document"]["execute"](
        db, engineer_user, attachment_id=str(att.id))
    assert "图纸A.pdf" in out["_card"]["payload"]["label"]


def test_download_document_label_fallback_when_missing(db, engineer_user):
    out = tools.REGISTRY["download_document"]["execute"](
        db, engineer_user, attachment_id=str(uuid.uuid4()))
    assert out["_card"]["payload"]["label"] == "下载文档"


def _make_attachment(db, file_name, file_path="doc/x/file.md"):
    att = models.DocumentAttachment(id=uuid.uuid4(), document_id=uuid.uuid4(),
                                    file_name=file_name, file_path=file_path)
    db.add(att); db.commit(); db.refresh(att)
    return att


def test_read_attachment_content_for_engineer(db, engineer_user, monkeypatch):
    att = _make_attachment(db, "说明.md")
    monkeypatch.setattr(tools.file_storage, "read_file",
                        lambda p: "# 标题\n附件正文".encode("utf-8"))
    out = tools.REGISTRY["read_attachment_content"]["execute"](
        db, engineer_user, attachment_id=str(att.id))
    assert "附件正文" in out["text"]


def test_read_attachment_content_denied_for_guest(db, guest_user, monkeypatch):
    att = _make_attachment(db, "说明.md")
    monkeypatch.setattr(tools.file_storage, "read_file",
                        lambda p: b"secret")
    out = tools.REGISTRY["read_attachment_content"]["execute"](
        db, guest_user, attachment_id=str(att.id))
    assert "error" in out and "text" not in out


def test_read_attachment_content_missing_attachment(db, engineer_user):
    out = tools.REGISTRY["read_attachment_content"]["execute"](
        db, engineer_user, attachment_id=str(uuid.uuid4()))
    assert "error" in out


def test_read_attachment_content_missing_file(db, engineer_user, monkeypatch):
    att = _make_attachment(db, "说明.md")
    def boom(p):
        raise FileNotFoundError("文件不存在")
    monkeypatch.setattr(tools.file_storage, "read_file", boom)
    out = tools.REGISTRY["read_attachment_content"]["execute"](
        db, engineer_user, attachment_id=str(att.id))
    assert "error" in out


def test_use_skill_returns_instructions(db, engineer_user):
    out = tools.REGISTRY["use_skill"]["execute"](
        db, engineer_user, name="bom_change_impact")
    assert out["skill"] == "bom_change_impact"
    assert "trace_bom" in out["instructions"]


def test_use_skill_unknown_returns_error(db, engineer_user):
    out = tools.REGISTRY["use_skill"]["execute"](
        db, engineer_user, name="不存在的技能")
    assert "error" in out


def test_use_skill_role_gated(db, guest_user):
    # project_summary_report 限 admin/engineer，guest 不可用
    out = tools.REGISTRY["use_skill"]["execute"](
        db, guest_user, name="project_summary_report")
    assert "error" in out
