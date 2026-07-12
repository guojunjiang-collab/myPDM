---
name: project_summary_report
description: 当用户要对某型号、项目或主题做总结、汇总或生成报告时使用
enabled: true
roles: [admin, engineer]
---
目标：基于系统内数据，为指定型号/项目生成一份结构化总结报告。

步骤：
1. 若用户明确指向某「项目」：先用 call_read_api 调 /api/projects 找到项目，再取 /api/projects/{id}、/api/projects/{id}/tasks、/api/projects/{id}/gantt 等接口获取项目详情、任务清单与进度。
2. 用关键词跨数据类型检索：零件、部件、构型项、图文档、ECR、ECO（用 search_entity 与 call_read_api 遍历各列表/搜索接口），找出所有相关记录。
3. 注意主题关键词可能只出现在图文档的「附件文件名」里——务必用 call_read_api 列出附件元数据（/api/v2/attachments/），按附件文件名匹配，避免漏掉相关文档。
4. 对相关记录取完整字段（详情接口），对相关图文档取得 attachment_id 后用 read_attachment_content 读取附件正文。
5. 严格遵守信息接地约束：只综合以上检索到的数据，不臆断、不引入系统外信息；缺数据如实说明。
6. 用 create_document 生成 Markdown 报告（含概要、关键数据、附件要点），返回可下载产物。
