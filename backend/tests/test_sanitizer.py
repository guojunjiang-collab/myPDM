from app.assistant.sanitizer import sanitize_for_llm


def test_strips_sensitive_keys_recursively():
    data = {"code": "P-1", "cost": 12.5, "supplier": "ACME",
            "children": [{"name": "x", "price": 9}]}
    out = sanitize_for_llm(data)
    assert "cost" not in out and "supplier" not in out
    assert "price" not in out["children"][0]
    assert out["code"] == "P-1"


def test_passes_through_plain_values():
    assert sanitize_for_llm("hello") == "hello"
    assert sanitize_for_llm([1, 2]) == [1, 2]
