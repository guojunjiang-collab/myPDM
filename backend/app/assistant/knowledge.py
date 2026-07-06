"""自生数据字典：内省 SQLAlchemy 模型 + 人工词汇表。"""
from sqlalchemy import inspect as sa_inspect

from .. import models, models_ecr, models_eco, models_configuration, models_parts
from .knowledge_glossary import GLOSSARY, OVERVIEW

ENTITY_MODELS = {
    "component": models_parts.PartMaster,
    "part": models_parts.PartMaster,
    "assembly": models_parts.PartMaster,
    "bom_item": models.BOMItem,
    "document": models.Document,
    "attachment": models.DocumentAttachment,
    "custom_field_definition": models.CustomFieldDefinition,
    "custom_field_value": models.CustomFieldValue,
    "ecr": models_ecr.ECR,
    "eco": models_eco.ECO,
    "configuration_item": models_configuration.ConfigurationItem,
    "configuration_profile": models_configuration.ConfigurationProfile,
}


def _fields(model):
    return [{"name": c.name, "type": str(c.type), "nullable": bool(c.nullable)}
            for c in sa_inspect(model).columns]


def build_data_dictionary() -> dict:
    return {k: {"fields": _fields(m), "glossary": GLOSSARY.get(k)}
            for k, m in ENTITY_MODELS.items()}


def get_data_dictionary(db, user, entity=None):
    """工具：无参返回实体清单+词汇表概要；带 entity 返回该实体字段字典。"""
    if entity is None:
        return {"entities": list(ENTITY_MODELS.keys()), "glossary": GLOSSARY}
    key = entity.lower()
    if key not in ENTITY_MODELS:
        return {"error": f"未知实体 {entity}", "entities": list(ENTITY_MODELS.keys())}
    return {"entity": key, "fields": _fields(ENTITY_MODELS[key]),
            "glossary": GLOSSARY.get(key)}


def build_overview() -> str:
    return OVERVIEW
