"""
文档附件路径迁移：旧 document/{code}_{version}/filename 扁平
           → 新 document/{code}/{version}/{iteration}/filename 分层
"""
import os, sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import psycopg2, psycopg2.extras

BASE = Path(__file__).resolve().parent.parent / "uploads"

DB = {
    "host": "bom_postgres", "port": 5432,
    "dbname": "bom_system", "user": "bomadmin", "password": "bompass",
}

conn = psycopg2.connect(**DB)
cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

cur.execute("""
    SELECT a.id AS att_id, a.file_path, a.file_name, a.iteration_id,
           d.code, d.version, COALESCE(di.iteration, 1) AS iteration
    FROM document_attachments a
    JOIN documents d ON d.id = a.document_id
    LEFT JOIN document_iterations di ON di.id = a.iteration_id
    WHERE a.file_path IS NOT NULL
""")
rows = cur.fetchall()
print(f"Total attachments: {len(rows)}")

moved = skipped = 0
for r in rows:
    old_full = BASE / r["file_path"]  # e.g. uploads/document/CODE_A/test.txt
    # new path: document/{code}/{version}/{iteration}/filename
    new_rel = f"document/{r['code']}/{r['version']}/{r['iteration']}/{r['file_name']}"
    new_full = BASE / new_rel

    # 检查是否已是新格式路径
    old_str = r["file_path"]
    if f"/{r['code']}/{r['version']}/{r['iteration']}/" in old_str:
        skipped += 1
        continue

    if not old_full.exists():
        print(f"[SKIP] missing: {old_str}")
        skipped += 1
        continue

    new_full.parent.mkdir(parents=True, exist_ok=True)
    try:
        os.rename(str(old_full), str(new_full))
    except OSError as e:
        print(f"[FAIL] rename {old_str}: {e}")
        skipped += 1
        continue

    cur.execute("UPDATE document_attachments SET file_path = %s WHERE id = %s", (new_rel, r["att_id"]))
    moved += 1
    print(f"[OK] {old_str} -> {new_rel}")

conn.commit()
cur.close(); conn.close()
print(f"\nDone: moved={moved}, skipped={skipped}")
