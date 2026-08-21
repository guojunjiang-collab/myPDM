# 构型配置 "导出平铺BOM" — 设计文档

**日期**: 2026-08-07
**状态**: 进行中

---

## 需求

构型配置详情页增加"导出平铺BOM"按钮，导出该构型项对应的所有零部件叶项及数量。

## 平铺BOM 算法

1. 取构型项当前迭代关联的所有零部件（`configuration_item_parts`）
2. 对每个关联零部件：
   - 类型为 `part`：直接加入结果，数量 = 关联数量
   - 类型为 `assembly`：递归展开 BOM 子项，子项数量 = 父级子项数量 × 关联数量；仅保留叶节点（`part`）
3. 按 `(master_id, revision_id)` 去重合并数量
4. 查询每个零部件的自定义字段值
5. 导出 Excel（件号/名称/版本/数量/状态/各自定义字段）

## 实现

| 层 | 内容 |
|----|------|
| 后端 | `GET /api/configuration/items/{revision_id}/flatten-bom` 返回 JSON |
| 前端 | `ConfigItemDetailModal.tsx` 加按钮，用 `xlsx` 生成 Excel |

## 涉及文件

- `routers/configuration.py` — 新增端点
- `ConfigItemDetailModal.tsx` — 新增按钮
