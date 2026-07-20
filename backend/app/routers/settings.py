"""系统配置 API 路由"""
from __future__ import annotations
import os
from fastapi import APIRouter

router = APIRouter(tags=["settings"])


@router.get("/cad-naming")
def get_cad_naming():
    """获取 CAD 工作台附件命名前缀配置"""
    return {
        "pdfPartPrefix": os.environ.get("CAD_PDF_PART_PREFIX", ""),
        "pdfAssemblyPrefix": os.environ.get("CAD_PDF_ASSEMBLY_PREFIX", ""),
        "stpPrefix": os.environ.get("CAD_STP_PREFIX", ""),
    }
