---
name: bom_compare_report
description: 当用户要对比两个零部件（或两个版本）的 BOM 差异时使用
enabled: true
---
目标：对比两个零部件的 BOM，输出差异。

步骤：
1. 用 search_entity 解析用户给出的两个零部件，得到各自 ID。
2. 用 diff_bom 对比两者（左/右）。
3. 整理差异为「新增 / 删除 / 数量变更」三类，配合表格呈现。
4. 用文字概括主要差异；如用户需要，用 create_document 生成对比报告产物。
5. 仅基于 diff_bom 返回的数据，不臆断。
