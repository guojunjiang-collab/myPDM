"""权限接线防回归检查（静态扫描，不起服务）。

守两条容易长期潜伏的问题：
1. `permissions.json` 里声明了 object_policy，但没人调用 —— `require_permission()`
   只做角色门，声明本身不会被强制执行，漏调用不报错、静默放行（审计问题 #11）。
2. 定义了权限项却无任何门禁引用（死权限），或路由引用了未定义的权限名。
"""
import json
import re
from pathlib import Path

from app.permissions import OBJECT_POLICIES, PERMISSIONS
from app.permissions.policies import _POLICY_FUNCS

BACKEND_APP = Path(__file__).resolve().parents[1] / "app"
ROUTERS = BACKEND_APP / "routers"
REPO_ROOT = Path(__file__).resolve().parents[2]

# 前端专用权限（只用于导航可见性，后端没有对应端点）
FRONTEND_ONLY = {p for p in PERMISSIONS if p.startswith("nav.")}
# 仅用于签发媒体令牌，通过 _ACTION_PERM 映射间接引用
MEDIA_TOKEN_PERMS = {
    "attachments:preview", "attachments:direct_download",
    "attachments:gltf", "attachments:archive_browse",
}


def _py_sources(root: Path):
    for f in root.rglob("*.py"):
        if "__pycache__" in f.parts:
            continue
        yield f, f.read_text(encoding="utf-8")


def test_every_declared_object_policy_is_registered():
    for perm, policy in OBJECT_POLICIES.items():
        assert policy in _POLICY_FUNCS, f"{perm} 声明了未注册的策略 {policy}"


def test_every_declared_object_policy_is_actually_enforced():
    """声明即须调用：策略名必须在某个 router 里出现在 enforce/check_object_policy 调用中。"""
    called = set()
    for _f, text in _py_sources(ROUTERS):
        called |= set(re.findall(r'(?:enforce|check)_object_policy\(\s*"([^"]+)"', text))
    # crud 层也允许承载策略调用（如 crud_groups 的图文档内容访问）
    for _f, text in _py_sources(BACKEND_APP):
        called |= set(re.findall(r'(?:enforce|check)_object_policy\(\s*"([^"]+)"', text))

    missing = {perm: policy for perm, policy in OBJECT_POLICIES.items() if policy not in called}
    assert not missing, (
        "以下权限声明了 object_policy 但没有任何路由/CRUD 调用它，"
        f"角色门会静默放行：{missing}"
    )


def test_registered_policies_are_all_declared_or_documented():
    """反向检查：注册了策略却既没在 json 声明、也没人调用 → 说明是残留代码。"""
    declared = set(OBJECT_POLICIES.values())
    called = set()
    for _f, text in _py_sources(BACKEND_APP):
        called |= set(re.findall(r'(?:enforce|check)_object_policy\(\s*"([^"]+)"', text))
    orphans = set(_POLICY_FUNCS) - declared - called
    assert not orphans, f"注册了但既未声明也未被调用的策略：{orphans}"


def test_no_dead_permissions():
    """每个权限项都要有引用：后端门禁、前端 can()、或媒体令牌映射。"""
    backend_used = set()
    for _f, text in _py_sources(BACKEND_APP):
        backend_used |= set(re.findall(r'require_permission\(\s*"([^"]+)"', text))
        backend_used |= set(re.findall(r'has_permission\([^,]+,\s*"([^"]+)"', text))

    frontend_used = set()
    fe_root = REPO_ROOT / "frontend" / "src"
    if fe_root.exists():
        for f in list(fe_root.rglob("*.ts")) + list(fe_root.rglob("*.tsx")):
            if "node_modules" in f.parts or f.name == "permissions.generated.ts":
                continue
            text = f.read_text(encoding="utf-8")
            frontend_used |= set(re.findall(r"can\(\s*'([^']+)'", text))
            frontend_used |= set(re.findall(r'can\(\s*"([^"]+)"', text))
            # Layout 的导航项以 perm: 'nav.x' 形式声明
            frontend_used |= set(re.findall(r"perm:\s*'([^']+)'", text))

    dead = set(PERMISSIONS) - backend_used - frontend_used - MEDIA_TOKEN_PERMS
    assert not dead, f"定义了但无任何引用的权限项（死权限）：{sorted(dead)}"


def test_no_undefined_permission_referenced():
    referenced = set()
    for _f, text in _py_sources(BACKEND_APP):
        referenced |= set(re.findall(r'require_permission\(\s*"([^"]+)"', text))
        referenced |= set(re.findall(r'has_permission\([^,]+,\s*"([^"]+)"', text))
    unknown = referenced - set(PERMISSIONS)
    assert not unknown, f"引用了未定义的权限名：{sorted(unknown)}"


def test_generated_matches_permissions_json():
    """生成物必须与事实源一致（防止手改 _generated.py 或忘跑生成器）。"""
    raw = json.loads((REPO_ROOT / "permissions" / "permissions.json").read_text(encoding="utf-8"))
    expected = {}
    expected_policies = {}
    for perm, spec in raw["permissions"].items():
        if isinstance(spec, dict):
            expected[perm] = spec["roles"]
            if spec.get("object_policy"):
                expected_policies[perm] = spec["object_policy"]
        else:
            expected[perm] = spec
    assert PERMISSIONS == {k: list(v) for k, v in expected.items()}
    assert OBJECT_POLICIES == expected_policies


def test_frontend_only_perms_have_no_backend_gate():
    """nav.* 是纯前端导航权限，不应挂到后端端点上（避免语义混淆）。"""
    backend_used = set()
    for _f, text in _py_sources(BACKEND_APP):
        backend_used |= set(re.findall(r'require_permission\(\s*"([^"]+)"', text))
    assert not (FRONTEND_ONLY & backend_used)
