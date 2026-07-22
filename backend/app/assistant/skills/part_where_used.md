---
name: part_where_used
description: 当用户问某零部件（零件/部件/构型项）用在哪些地方、被哪些装配或图文档引用时使用
enabled: true
---
目标：查询某零部件的使用情况（反查）。

步骤：
1. 用 search_entity 定位该零部件。
2. 用 trace_bom 列出所有使用它的上层父装配。
3. 用 call_read_api 查与之关联的图文档（该实体的 documents 接口）。
4. 汇总为「被哪些部件使用」「关联哪些图文档」两部分清单。
5. 仅基于检索结果，不臆断；无引用则如实说明。
