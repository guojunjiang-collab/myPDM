# CAD BOM 匹配表格自定义字段滚动区 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 CAD BOM 匹配表格拆分为双表布局，自定义字段列放入独立水平滚动区

**Architecture:** 单一表格拆为左右两个 `<table>`，左表渲染固定列（shrink-0），右表渲染自定义字段列（flex-1 + max-w-[50%] + overflow-x-auto），两表在同一垂直滚动容器内自然同步滚动

**Tech Stack:** React 18 + TypeScript + Tailwind CSS 3

## 全局约束

- 仅修改 `CADBOMMatchTable.tsx`，不动数据逻辑和交互函数
- 弹窗宽度 `max`（约 1280px），高度 `85vh`
- 不引入新依赖
- 固定列：层级、件号、用量、版本、术语/中文名称、CAD附件、生产附件、PDM匹配、匹配状态、签出状态、操作

---

### Task 1: 拆分表格为双表布局

**Files:**
- Modify: `frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx:488-690`

**Interfaces:**
- 无新增接口；仅重构现有 JSX 渲染结构
- 所有 props、state、callback 保持不变

- [ ] **Step 1: 重构表格容器结构**

将当前 `<div className="flex-1 min-h-0 overflow-auto">` 表格容器改为双表布局：

```tsx
{/* 表格：固定列左侧 + 自定义字段右侧滚动 */}
<div className="flex-1 min-h-0">
  <div className="h-full overflow-y-auto overflow-x-hidden">
    <div className="flex">
      {/* ====== 左表：固定列 ====== */}
      <table className="shrink-0 border-collapse text-xs whitespace-nowrap">
        <thead className="sticky top-0 z-10">
          <tr className="bg-gray-50 shadow-[0_2px_0_0_#e5e7eb]">
            <th className="p-2 text-left bg-gray-50">层级</th>
            <th className="p-2 text-left bg-gray-50">件号</th>
            <th className="p-2 text-center bg-gray-50">用量</th>
            {BUILTIN_COLUMNS.map(col => (
              <th key={col.attr} className={`p-2 text-left bg-sky-50 ${col.width || ''}`}>{col.label}</th>
            ))}
            <th className="p-2 text-center bg-blue-50">CAD附件</th>
            <th className="p-2 text-center bg-amber-50">生产附件</th>
            <th className="p-2 text-left bg-gray-50">PDM匹配</th>
            <th className="p-2 text-left bg-gray-50">匹配状态</th>
            <th className="p-2 text-left bg-gray-50">签出状态</th>
            <th className="p-2 text-center bg-gray-50">操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <tr key={row.path} className={`border-b border-gray-200 transition-colors ${
              row.match_status === 'new' ? 'bg-yellow-50 hover:bg-yellow-100' :
              row.checkout_status === 'checked_out' ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-100'
            }`}>
              {/* 层级 */}
              <td className="p-2">
                {row.level === 0 ? <strong>{row.level}</strong> : row.path.replace('0.', '')}
              </td>
              {/* 件号 */}
              <td className="p-2">{row.builtin.PartNumber || ''}</td>
              {/* 用量 */}
              <td className="p-2 text-center">{row.quantity}</td>

              {/* 内置属性列 */}
              {BUILTIN_COLUMNS.map(col => (
                <td key={col.attr} className={`p-2 bg-sky-50 ${col.width || ''}`}>
                  <input
                    value={row.builtin[col.attr] || ''}
                    disabled={!canEditProps(row)}
                    onChange={(e) => {
                      const val = e.target.value;
                      setRows(prev => syncRowsByPartNumber(prev, row, col.attr, val, 'builtin'));
                      handleBuiltinEdit(row, col.attr, val);
                    }}
                    className="border border-sky-300 rounded px-1.5 py-0.5 w-full text-xs disabled:bg-gray-100 disabled:border-gray-200"
                  />
                </td>
              ))}

              {/* CAD附件 */}
              <td className="p-2 text-center bg-blue-50">
                {(() => {
                  const n = row.pdm_match?.revision_id ? attCounts[row.pdm_match.revision_id]?.cad : undefined;
                  return (
                    <div className={`text-xs ${n ? 'font-semibold text-blue-600' : 'text-gray-500'}`}>
                      {n !== undefined ? n : '—'}
                    </div>
                  );
                })()}
                {isCheckedOutByMe(row) && (
                  <button
                    onClick={() => handleUploadCAD(row)}
                    disabled={uploadingCad === row.path}
                    title={row.doc_path || 'CATIA 源文件路径未知'}
                    className="mt-1 px-2 py-0.5 bg-blue-500 text-white rounded text-xs hover:bg-blue-600 disabled:bg-gray-300"
                  >
                    {uploadingCad === row.path ? '上传中...' : '上传源文件'}
                  </button>
                )}
                {!row.pdm_match && <span className="text-gray-400 text-xs">—</span>}
                {row.pdm_match && !isCheckedOutByMe(row) && !isCheckedOutByOther(row) && (
                  <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded text-xs cursor-not-allowed">需签出</button>
                )}
                {isCheckedOutByOther(row) && (
                  <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded text-xs cursor-not-allowed">他人签出</button>
                )}
              </td>

              {/* 生产附件 */}
              <td className="p-2 text-center bg-amber-50">
                {(() => {
                  const n = row.pdm_match?.revision_id ? attCounts[row.pdm_match.revision_id]?.production : undefined;
                  return (
                    <div className={`text-xs ${n ? 'font-semibold text-amber-600' : 'text-gray-500'}`}>
                      {n !== undefined ? n : '—'}
                    </div>
                  );
                })()}
                {isCheckedOutByMe(row) && (
                  <div className="flex gap-1 justify-center mt-1">
                    <button
                      onClick={() => handleUploadPDF(row)}
                      disabled={uploadingPdf === row.path}
                      title="通过桥接程序将工程图(CATDrawing)转 PDF 并上传（同名覆盖）"
                      className="px-2 py-0.5 bg-red-500 text-white rounded text-xs hover:bg-red-600 disabled:bg-gray-300"
                    >
                      {uploadingPdf === row.path ? '转换中...' : 'PDF'}
                    </button>
                    <button
                      onClick={() => handleUploadSTP(row)}
                      disabled={uploadingStp === row.path}
                      title="通过桥接程序将 CATIA 零部件导出为 STP 并上传（同名覆盖）"
                      className="px-2 py-0.5 bg-purple-500 text-white rounded text-xs hover:bg-purple-600 disabled:bg-gray-300"
                    >
                      {uploadingStp === row.path ? '导出中...' : 'STP'}
                    </button>
                  </div>
                )}
                {!row.pdm_match && <span className="text-gray-400 text-xs">—</span>}
                {row.pdm_match && !isCheckedOutByMe(row) && !isCheckedOutByOther(row) && (
                  <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded text-xs cursor-not-allowed">需签出</button>
                )}
                {isCheckedOutByOther(row) && (
                  <button disabled className="mt-1 px-2 py-0.5 bg-gray-200 text-gray-400 rounded text-xs cursor-not-allowed">他人签出</button>
                )}
              </td>

              {/* PDM匹配 */}
              <td className="p-2">
                {row.match_status === 'conflict' && row.pdm_match ? (
                  <span className="text-red-600">
                    {row.pdm_match.latest_version
                      ? `版本冲突 (PDM最新: v${row.pdm_match.latest_version})`
                      : '版本冲突'}
                  </span>
                ) : row.pdm_match?.master_id ? (
                  <span
                    onClick={() => setDetailPart({ masterId: row.pdm_match!.master_id!, revisionId: row.pdm_match!.revision_id })}
                    className="text-blue-600 cursor-pointer hover:underline"
                    title="查看零部件详情"
                  >
                    {row.pdm_match.code} (v{row.pdm_match.version})
                  </span>
                ) : row.pdm_match ? (
                  <span className="text-blue-600">{row.pdm_match.code} (v{row.pdm_match.version})</span>
                ) : (
                  <span className="text-amber-600">— 无 —</span>
                )}
              </td>

              {/* 匹配状态 */}
              <td className="p-2">
                {row.match_status === 'matched' && <span className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-xs">已匹配</span>}
                {row.match_status === 'new' && <span className="bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full text-xs">可新建</span>}
                {row.match_status === 'conflict' && <span className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-xs">冲突</span>}
                {row.match_status === 'unknown' && <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full text-xs">未知</span>}
              </td>

              {/* 签出状态 */}
              <td className="p-2">
                {row.checkout_status === 'not_checked_out' && <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">未签出</span>}
                {row.checkout_status === 'checked_out' && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full text-xs">已签出</span>}
                {row.checkout_status === 'other_checked_out' && <span className="bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full text-xs">他人签出</span>}
                {row.checkout_status === null && <span className="text-gray-400 text-xs">—</span>}
              </td>

              {/* 操作 */}
              <td className="p-2 text-center">
                <div className="flex gap-1 flex-wrap justify-center">
                  {row.match_status === 'new' && (
                    <button onClick={() => handleCreatePart(row)} className="px-2 py-1 bg-amber-500 text-white rounded text-xs hover:bg-amber-600">创建零件</button>
                  )}
                  {row.match_status === 'matched' && row.checkout_status === 'not_checked_out' && (
                    <>
                      <button onClick={() => handleCheckout(row)} className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">签出</button>
                      <button onClick={() => handlePullFromPDM(row)} className="px-2 py-1 bg-amber-50 text-amber-700 border border-amber-300 rounded text-xs hover:bg-amber-100">属性←</button>
                    </>
                  )}
                  {row.match_status === 'matched' && row.checkout_status === 'checked_out' && (
                    <>
                      <button onClick={() => handleCheckin(row)} className="px-2 py-1 bg-emerald-500 text-white rounded text-xs hover:bg-emerald-600">签入</button>
                      <button onClick={() => handlePushToPDM(row)} className="px-2 py-1 bg-blue-100 text-blue-700 border border-blue-300 rounded text-xs hover:bg-blue-200">属性→</button>
                      <button onClick={() => handleUndoCheckout(row)} className="px-2 py-1 bg-red-50 text-red-700 border border-red-300 rounded text-xs hover:bg-red-100">撤销</button>
                    </>
                  )}
                  {row.match_status === 'matched' && row.checkout_status === 'other_checked_out' && (
                    <button onClick={() => handlePullFromPDM(row)} className="px-2 py-1 bg-amber-50 text-amber-700 border border-amber-300 rounded text-xs hover:bg-amber-100">属性←</button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ====== 右表：自定义字段滚动区 ====== */}
      <div className="flex-1 overflow-x-auto" style={{ maxWidth: '50%' }}>
        <table className="border-collapse text-xs whitespace-nowrap w-full">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gray-50 shadow-[0_2px_0_0_#e5e7eb]">
              {propertyColumns.map(col => (
                <th key={col} className="p-2 text-left bg-green-50">{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.path} className={`border-b border-gray-200 transition-colors ${
                row.match_status === 'new' ? 'bg-yellow-50 hover:bg-yellow-100' :
                row.checkout_status === 'checked_out' ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-100'
              }`}>
                {propertyColumns.map(col => {
                  const catiaProp = getCatiaPropForPdmField(col);
                  const value = catiaProp ? (row.user_properties[catiaProp] || '') : '';
                  return (
                    <td key={col} className="p-2 bg-green-50">
                      <input
                        value={value}
                        disabled={!canEditProps(row) || !catiaProp}
                        onChange={(e) => {
                          if (!catiaProp) return;
                          const val = e.target.value;
                          setRows(prev => syncRowsByPartNumber(prev, row, catiaProp, val));
                          handlePropEdit(row, catiaProp, val);
                        }}
                        className="border border-blue-300 rounded px-1.5 py-0.5 w-full text-xs disabled:bg-gray-100 disabled:border-gray-200"
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  </div>
</div>
```

> 上述代码替换当前文件第 488-690 行的 table JSX（汇总栏下方、PartDetailModal 上方的整个表格渲染块）

- [ ] **Step 2: 构建前端验证编译**

```powershell
npm run build
```

- [ ] **Step 3: 部署验证**

```powershell
docker-compose up -d --force-recreate nginx
```

浏览器刷新（Ctrl+F5）进入 CAD 入口 → BOM匹配，验证：
- 左右表行高对齐
- 自定义字段区可独立水平滚动
- 两表垂直同步滚动
- 固定列始终可见
- 所有编辑、上传、推送功能正常

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/CADWorkspace/CADBOMMatchTable.tsx
git commit -m "feat: CAD BOM匹配表格自定义字段独立水平滚动区"
```
