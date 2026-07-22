"""PDM 领域词汇表与系统提示速览（人工维护，代码表达不出的语义）。"""

GLOSSARY = {
    "component": "零部件：零件和部件的统一称谓。code=编码，name=名称，spec=规格，version=版本，status=状态，component_type=类型(part零件/assembly部件)，软删除用 deleted_at。",
    "part": "零件：零部件的一种类型（component_type='part'），最小物料单元。与 component 共享同一表结构。",
    "assembly": "部件/装配体：零部件的一种类型（component_type='assembly'），可含 BOM 子项。与 component 共享同一表结构。",
    "bom_item": ("BOM 关系行：parent_revision_id → child_revision_id，quantity=用量。"
                 "deleted_at 软删除。重构后统一使用 revision 级别关系。"),
    "document": "图文档：含 revisions 版本、document_links 关联。附件元数据见 attachment。",
    "attachment": "文档附件元数据：文件名、大小、哈希、路径。二进制内容不经 AI（用下载工具取链接）。",
    "configuration_item": ("构型项：面向交付/配置的清单单元，**与 BOM 不同**——BOM 是制造结构，"
                            "构型是配置视角。含 document_links。"),
    "configuration_profile": "构型清单/配置概要：一组构型项的集合，有 status 状态。",
    "ecr": "变更请求(ECR)：发起变更的申请，含受影响项、评审记录、状态流转。",
    "eco": "变更执行(ECO)：由 ECR 转化的执行单，含执行项、评审、状态日志。ecr_id 关联来源 ECR。",
    "custom_field_definition": "自定义字段定义：name、field_type、options、applies_to（适用实体数组）。",
    "custom_field_value": "自定义字段值：entity_type/entity_id 关联到具体实体，value/value_json。",
    "project": "项目：含 name、code、status、负责人、起止日期、tags。",
    "project_task": "项目任务：含 name、状态、优先级、负责人、起止日期、进度、层级关系(parent_task_id)。支持甘特图排程与任务依赖。",
}

ROLE_CAPABILITIES = {
    "admin": "全部数据与操作",
    "engineer": "查看、编辑（无删除），可下载/导出",
    "production": "查看、下载、导出，不可编辑删除",
    "guest": "仅查看，不可下载/导出",
}

OVERVIEW = (
    "你管理的 PDM 系统含以下业务数据（字段含义用 get_data_dictionary 查，接口用 list_api_endpoints 查）：\n"
    "- 零部件 component（零件和部件统一管理，component_type 区分 part/assembly）、BOM（bom_item，父子结构带 quantity）\n"
    "- 图文档 document 及附件 attachment（附件二进制不直接读，下载走下载工具）\n"
    "- 构型 configuration（与 BOM 不同，是配置/交付视角的清单）\n"
    "- 项目管理 project/project_task（含甘特图排程、任务依赖、关联对象）\n"
    "- 自定义字段 custom_field、变更请求 ECR、变更执行 ECO\n"
    "关系：BOM 子项基于 revision 级别（parent_revision_id → child_revision_id）；软删除用 deleted_at。\n"
    "需要任何数据：先 list_api_endpoints 找接口，再 call_read_api 取数；结果过大用 limit/search 缩小。"
)
