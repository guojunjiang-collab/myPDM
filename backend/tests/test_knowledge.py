from app.assistant import knowledge


def test_data_dictionary_covers_core_entities():
    d = knowledge.build_data_dictionary()
    for key in ["part", "assembly", "bom_item", "document", "ecr", "eco",
                "configuration_item"]:
        assert key in d
        assert d[key]["fields"]  # 非空字段列表


def test_part_dictionary_has_code_field():
    d = knowledge.build_data_dictionary()
    names = {f["name"] for f in d["part"]["fields"]}
    assert "code" in names


def test_get_data_dictionary_for_entity():
    out = knowledge.get_data_dictionary(None, None, entity="part")
    assert out["entity"] == "part"
    assert any(f["name"] == "code" for f in out["fields"])


def test_get_data_dictionary_no_arg_lists_entities():
    out = knowledge.get_data_dictionary(None, None)
    assert "part" in out["entities"]
    assert "glossary" in out


def test_get_data_dictionary_unknown_entity():
    out = knowledge.get_data_dictionary(None, None, entity="nope")
    assert "error" in out


def test_overview_mentions_key_concepts():
    ov = knowledge.build_overview()
    assert "构型" in ov and "ECR" in ov
