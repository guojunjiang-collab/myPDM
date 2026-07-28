#!/usr/bin/env python3
"""签发 license 文件并记录台账。

Run:
  python tools/license_issuer/issue.py \
    --customer "某某机械有限公司" --machine-code "a3f29c81-4d07e5b2-77c10fa9" \
    --expires 2027-07-28 --max-users 50 --edition full \
    --out ./licenses/某某机械_20260728.lic
"""
import argparse
import base64
import csv
import json
from datetime import date
from pathlib import Path

from cryptography.hazmat.primitives import serialization

try:
    from canonical import canonical_bytes
except ImportError:
    from .canonical import canonical_bytes

EDITION_MODULES: dict[str, tuple[str, ...]] = {
    "basic": (),
    "full": ("change", "inventory", "project"),
}

LEDGER_COLUMNS = ["license_id", "customer", "machine_code", "issued_at",
                  "expires_at", "max_users", "modules", "edition"]


def build_payload(*, license_id: str, customer: str, machine_code: str,
                  issued_at: str, expires_at: str, grace_days: int,
                  max_users: int, edition: str,
                  modules: list[str] | None = None) -> dict:
    if edition not in EDITION_MODULES:
        raise ValueError(f"未知版本 {edition}，可选：{','.join(EDITION_MODULES)}")
    resolved = list(modules) if modules is not None else list(EDITION_MODULES[edition])
    unknown = set(resolved) - set(EDITION_MODULES["full"])
    if unknown:
        raise ValueError(f"未知模块：{','.join(sorted(unknown))}")
    return {
        "license_id": license_id,
        "customer": customer,
        "machine_code": machine_code,
        "issued_at": issued_at,
        "expires_at": expires_at,
        "grace_days": int(grace_days),
        "max_users": int(max_users),
        "modules": resolved,
        "edition": edition,
    }


def sign_payload(payload: dict, private_key_pem: bytes) -> bytes:
    priv = serialization.load_pem_private_key(private_key_pem, password=None)
    sig = priv.sign(canonical_bytes(payload))
    doc = {"payload": payload, "signature": base64.b64encode(sig).decode()}
    return base64.b64encode(json.dumps(doc, ensure_ascii=False).encode("utf-8"))


def append_ledger(ledger_path: Path, payload: dict) -> None:
    exists = ledger_path.exists()
    ledger_path.parent.mkdir(parents=True, exist_ok=True)
    with ledger_path.open("a", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=LEDGER_COLUMNS)
        if not exists:
            writer.writeheader()
        writer.writerow({
            **{k: payload[k] for k in LEDGER_COLUMNS if k != "modules"},
            "modules": "|".join(payload["modules"]),
        })


def next_license_id(ledger_path: Path) -> str:
    year = date.today().year
    count = 0
    if ledger_path.exists():
        with ledger_path.open("r", encoding="utf-8-sig") as fh:
            count = sum(1 for _ in csv.DictReader(fh))
    return f"LIC-{year}-{count + 1:04d}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--customer", required=True)
    parser.add_argument("--machine-code", required=True)
    parser.add_argument("--expires", required=True, help="YYYY-MM-DD；永久授权填 9999-12-31")
    parser.add_argument("--max-users", type=int, required=True)
    parser.add_argument("--edition", choices=sorted(EDITION_MODULES), required=True)
    parser.add_argument("--modules", help="逗号分隔，覆盖 edition 默认模块（定制单用）")
    parser.add_argument("--grace-days", type=int, default=15)
    parser.add_argument("--key", default="./keys/private_key.pem")
    parser.add_argument("--ledger", default="./issued.csv")
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    ledger = Path(args.ledger)
    payload = build_payload(
        license_id=next_license_id(ledger),
        customer=args.customer,
        machine_code=args.machine_code,
        issued_at=date.today().isoformat(),
        expires_at=args.expires,
        grace_days=args.grace_days,
        max_users=args.max_users,
        edition=args.edition,
        modules=[m.strip() for m in args.modules.split(",")] if args.modules else None,
    )
    raw = sign_payload(payload, Path(args.key).read_bytes())
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(raw)
    append_ledger(ledger, payload)
    print(f"已签发 {payload['license_id']} → {out}")


if __name__ == "__main__":
    main()
