from .auth import router as auth_router
from .users import router as users_router
from .parts import router as parts_router
from .assemblies import router as assemblies_router
from .bom import router as bom_router
from .logs import router as logs_router
from .custom_fields import router as custom_fields_router
from .documents import router as documents_router
from .dashboard import router as dashboard_router
from .ecrs import router as ecr_router

from .ecos import router as eco_router

__all__ = ["auth_router", "users_router", "parts_router", "assemblies_router", "bom_router", "logs_router", "custom_fields_router", "documents_router", "dashboard_router", "ecr_router", "eco_router"]
