"""出境前脱敏：递归剔除敏感字段。

敏感字段集合可经 ASSISTANT_SENSITIVE_FIELDS（逗号分隔）覆盖。
"""
import os

_DEFAULT_SENSITIVE = {"cost", "price", "supplier", "supplier_code", "unit_price"}


def _sensitive_fields():
    extra = os.getenv("ASSISTANT_SENSITIVE_FIELDS", "")
    fields = set(_DEFAULT_SENSITIVE)
    if extra.strip():
        fields |= {f.strip() for f in extra.split(",") if f.strip()}
    return fields


def sanitize_for_llm(data):
    fields = _sensitive_fields()
    if isinstance(data, dict):
        return {k: sanitize_for_llm(v) for k, v in data.items() if k not in fields}
    if isinstance(data, list):
        return [sanitize_for_llm(v) for v in data]
    return data
