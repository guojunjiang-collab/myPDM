import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # tests -> backend -> myPDM


def _load_gen():
    spec = importlib.util.spec_from_file_location(
        "gen_permissions", ROOT / "tools" / "gen_permissions.py"
    )
    mod = importlib.util.module_from_spec(spec)
    sys.modules["gen_permissions"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_generated_files_in_sync():
    gen = _load_gen()
    backend_txt, frontend_txt = gen.build()
    committed_backend = (ROOT / "backend/app/permissions/_generated.py").read_text(encoding="utf-8")
    committed_frontend = (ROOT / "frontend/src/constants/permissions.generated.ts").read_text(encoding="utf-8")
    assert backend_txt == committed_backend, "后端产物过期，请运行: python tools/gen_permissions.py"
    assert frontend_txt == committed_frontend, "前端产物过期，请运行: python tools/gen_permissions.py"
