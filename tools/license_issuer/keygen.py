#!/usr/bin/env python3
"""生成 Ed25519 签发密钥对。一次性执行，此后永不重新生成。

私钥丢失 = 所有存量客户无法续期。生成后立即离线备份至少两份。

Run: python tools/license_issuer/keygen.py --out ./keys
"""
import argparse
import base64
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="./keys", help="密钥输出目录")
    args = parser.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    priv_path = out / "private_key.pem"
    if priv_path.exists():
        raise SystemExit(f"拒绝覆盖已存在的私钥：{priv_path}")

    priv = Ed25519PrivateKey.generate()
    priv_path.write_bytes(priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption()))
    pub_b64 = base64.b64encode(priv.public_key().public_bytes_raw()).decode()
    (out / "public_key.b64").write_text(pub_b64, encoding="utf-8")

    print(f"私钥已写入 {priv_path}（请立即离线备份两份）")
    print(f"公钥 base64（构建镜像时作为 LICENSE_PUBKEY 传入）：\n{pub_b64}")


if __name__ == "__main__":
    main()
