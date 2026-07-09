from app.schemas_parts import MatchReport


def test_match_report_has_split_fields():
    r = MatchReport(matched=[], unmatched=[], multi_instance=[],
                    generated=["A"], skipped_not_editable=["B"], failed=["C"])
    assert r.generated == ["A"]
    assert r.skipped_not_editable == ["B"]
    assert r.failed == ["C"]
