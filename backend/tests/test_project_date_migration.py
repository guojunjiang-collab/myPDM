from app.migrations_project import parse_iso_date


def test_parse_valid_iso():
    import datetime
    assert parse_iso_date("2026-01-05") == datetime.date(2026, 1, 5)


def test_parse_invalid_returns_none():
    assert parse_iso_date("") is None
    assert parse_iso_date(None) is None
    assert parse_iso_date("not-a-date") is None
    assert parse_iso_date("2026/01/05") is None
