"""PDM 领域词汇表与系统提示速览（人工维护，代码表达不出的语义）。"""

GLOSSARY = {
    "part": "零件：最小物料单元。code=编码，name=名称，spec=规格，version=版本，status=状态，软删除用 deleted_at。",
    "assembly": "部件/装配体：可含子项的层级单元。与零件结构相似，另有 revisions 版本数组、document_links 关联文档。",
    "bom_item": ("BOM 关系行：parent_type/parent_id → child_type/child_id，quantity=用量。"
                 "child_type 取值 part/assembly/component（component 兼容 assembly）。deleted_at 软删除。"),
    "document": "图文档：含 revisions 版本、document_links 关联。附件元数据见 attachment。",
    "attachment": "文档附件元数据：文件名、大小、哈希、路径。二进制内容不经 AI（用下载工具取链接）。",
    "configuration_item": ("构型项：面向交付/配置的清单单元，**与 BOM 不同**——BOM 是制造结构，"
                           "构型是配置视角。含 document_links。"),
    "configuration_profile": "构型清单/方案：一组构型项的集合，有 status 状态。",
    "ecr": "变更请求(ECR)：发起变更的申请，含受影响项、评审记录、状态流转。",
    "eco": "变更执行(ECO)：由 ECR 转化的执行单，含执行项、评审、状态日志。ecr_id 关联来源 ECR。",
    "custom_field_definition": "自定义字段定义：name、field_type、options、applies_to（适用实体数组）。",
    "custom_field_value": "自定义字段值：entity_type/entity_id 关联到具体实体，value/value_json。",
}

ROLE_CAPABILITIES = {
    "admin": "全部数据与操作",
    "engineer": "查看、编辑（无删除），可下载/导出",
    "production": "查看、下载、导出，不可编辑删除",
    "guest": "仅查看，不可下载/导出",
}

OVERVIEW = (
    "你管理的 PDM 系统含以下业务数据（字段含义用 get_data_dictionary 查，接口用 list_api_endpoints 查）：\n"
    "- 零件 part、部件 assembly、BOM（bom_item，父子结构带 quantity）\n"
    "- 图文档 document 及附件 attachment（附件二进制不直接读，下载走下载工具）\n"
    "- 构型 configuration（与 BOM 不同，是配置/交付视角的清单）\n"
    "- 自定义字段 custom_field、变更请求 ECR、变更执行 ECO\n"
    "关系：BOM 子项类型为 part/assembly/component（component 兼容 assembly）；软删除用 deleted_at。\n"
    "需要任何数据：先 list_api_endpoints 找接口，再 call_read_api 取数；结果过大用 limit/search 缩小。"
)
