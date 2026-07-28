"""许可管理接口。全部路径在中间件白名单内，保证只读态下仍可自救上传。"""
import uuid as _uuid

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..models_license import LicenseRecord
from ..permissions import require_permission
from . import fingerprint as fp
from . import state as st
from .verifier import LicenseError, verify_and_parse

router = APIRouter(prefix="/license", tags=["许可管理"])

MAX_LICENSE_BYTES = 16 * 1024


def _status_body(info: st.LicenseInfo, db: Session) -> dict:
    payload = info.payload or {}
    return {
        "state": info.state.value,
        "edition": payload.get("edition"),
        "customer": payload.get("customer"),
        "license_id": payload.get("license_id"),
        "issued_at": payload.get("issued_at"),
        "expires_at": payload.get("expires_at"),
        "days_left": info.days_left,
        "max_users": payload.get("max_users"),
        "used_users": st.count_active_users(db),
        "modules": sorted(info.modules),
        "reason": info.reason,
    }


@router.get("/status")
async def get_status(db: Session = Depends(get_db),
                     current_user: User = Depends(require_permission("license:read"))):
    return _status_body(st.load(), db)


@router.get("/machine-code")
async def get_machine_code(
    current_user: User = Depends(require_permission("license:manage"))
):
    return {"machine_code": fp.machine_code()}


@router.post("/upload")
async def upload_license(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_permission("license:manage")),
):
    raw = await file.read()
    if len(raw) > MAX_LICENSE_BYTES:
        raise HTTPException(status_code=400, detail="许可证文件过大")

    try:
        payload = verify_and_parse(raw)
    except LicenseError as exc:
        raise HTTPException(status_code=400, detail=f"许可证无效：{exc}") from exc

    if not fp.matches(payload["machine_code"]):
        raise HTTPException(status_code=400,
                            detail="许可证与本机硬件不匹配，请提供本机机器码重新申请")

    path = st.license_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)
    st.invalidate()

    db.add(LicenseRecord(
        id=_uuid.uuid4(),
        license_id=str(payload.get("license_id", "")),
        customer=str(payload.get("customer", "")),
        machine_code=str(payload.get("machine_code", "")),
        issued_at=str(payload.get("issued_at", "")),
        expires_at=str(payload.get("expires_at", "")),
        max_users=int(payload.get("max_users") or 0),
        modules=list(payload.get("modules") or []),
        edition=str(payload.get("edition", "basic")),
        uploaded_by=current_user.id,
    ))
    db.commit()

    return _status_body(st.load(force=True), db)
