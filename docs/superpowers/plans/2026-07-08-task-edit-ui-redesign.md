# 任务编辑界面 UI 改造实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 TaskEditModal 改造为上下分栏布局（核心信息卡片 + TAB 页），参考 PartDetailModal 风格

**Architecture:** 单一文件 `TaskEditModal.tsx` 内重构 JSX 布局结构，不动业务逻辑。外层用 `h-[65vh] flex flex-col` 容器，上区 shrink-0 放核心信息卡片，中区 flex-1 min-h-0 放 TAB 页，下区 shrink-0 放底部操作栏

**Tech Stack:** React 18 + TypeScript + Tailwind CSS

---

### Task 0: 准备和备份

**Files:**
- Read: `frontend/src/pages/Project/TaskEditModal.tsx`
- 无需创建新文件

- [ ] **Step 0: 检查当前状态**

```powershell
cd frontend; if ($?) { npx tsc --noEmit --pretty 2>&1 | Select-Object -First 20 }
```

确认当前文件无编译错误后再继续。

---

### Task 1: 更换 Modal 容器，建立上下分栏骨架

**Files:**
- Modify: `frontend/src/pages/Project/TaskEditModal.tsx`

**目标**: 将 `<Modal width="3xl">` 改为 `<Modal width="full">`，内层建立 `h-[65vh] flex flex-col` 骨架，并将所有子 Modal（详情弹窗等）挪到外层容器外。

- [ ] **Step 1.1: 修改 Modal width 和 title，替换最外层 JSX 容器结构**

找到 return 语句中的 `<Modal open={open} ...>` 和内部结构，替换为新的三区骨架。

**新代码**（从 return 开始，替换整个 return body）：

```tsx
  return (
    <Modal open={open} title={task ? `编辑任务` : '新建任务'} onClose={onClose} width="full">
      <div className="h-[65vh] flex flex-col">
        {/* === 核心信息区 === */}
        <div className="shrink-0 mb-3">
          <div className="grid grid-cols-6 gap-3">
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <div className="text-xs text-gray-500 mb-0.5">编号</div>
              <div className="text-sm text-gray-900 font-medium font-mono py-1">{task?.code || '—'}</div>
            </div>
            <div className="col-span-2 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">名称 <span className="text-red-500">*</span></label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                     className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">类型</label>
              <select value={form.task_type} onChange={(e) => setForm({ ...form, task_type: e.target.value as TaskType })}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">状态</label>
              <span className={`inline-block px-2 py-1 text-xs rounded-full ${STATUS_CLASS[form.status]}`}>{form.status}</span>
            </div>
            <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <label className="block text-xs text-gray-500 mb-0.5">优先级</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value as TaskPriority })}
                      className="w-full text-sm px-2 py-1 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* === TAB 区（仅编辑已有任务时显示，新建任务直接显示表单） === */}
        {task ? (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden flex-1 min-h-0 flex flex-col">
            <div className="flex border-b border-gray-200 shrink-0">
              {([['info', '基本信息'], ['links', '关联对象'], ['comments', '评论'], ['logs', '操作记录']] as [typeof tab, string][]).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                    tab === key ? 'border-primary-600 text-primary-600' : 'border-transparent text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {/* TAB 内容接后续任务填充 */}
            </div>
          </div>
        ) : (
          /* 新建任务：直接显示表单内容（无 TAB） */
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4">
            {/* 负责人、计划周期、描述 - 接 Task 2 */}
          </div>
        )}

        {/* === 底部操作栏 === */}
        <div className="flex justify-between gap-2 border-t pt-3 mt-3 shrink-0">
          <div className="flex gap-2">
            {task && form.status === '未开始' && (
              <button onClick={() => handleStatusAction('进行中')} disabled={statusSaving}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
                {statusSaving ? '...' : '▶ 开始任务'}
              </button>
            )}
            {task && form.status === '进行中' && (
              <>
                <button onClick={() => handleStatusAction('挂起')} disabled={statusSaving}
                        className="px-4 py-2 bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 text-sm">
                  {statusSaving ? '...' : '⏸ 暂停任务'}
                </button>
                <button onClick={() => handleStatusAction('已完成')} disabled={statusSaving}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 text-sm">
                  {statusSaving ? '...' : '✓ 完成任务'}
                </button>
              </>
            )}
            {task && form.status === '挂起' && (
              <button onClick={() => handleStatusAction('进行中')} disabled={statusSaving}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm">
                {statusSaving ? '...' : '▶ 恢复任务'}
              </button>
            )}
            {task && form.status === '已完成' && (
              <button onClick={() => handleStatusAction('进行中')} disabled={statusSaving}
                      className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 disabled:opacity-50 text-sm">
                {statusSaving ? '...' : '↩ 退回'}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50">取消</button>
            <button onClick={handleSave} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700">保存</button>
          </div>
        </div>
      </div>

      {/* ===== 所有子 Modal 保持不变 ===== */}
      {detailEntityId && detailEntityType === 'config_item' && (
        <ConfigurationDetailModal itemId={detailEntityId} onClose={() => { setDetailEntityId(null); setDetailEntityType(null); }} />
      )}
      {ecView?.kind === 'ecr' && (
        <ECRDetailModal open ecrId={ecView.id} onClose={() => setEcView(null)} onSuccess={() => {}} />
      )}
      {ecView?.kind === 'eco' && (
        <ECODetailModal ecoId={ecView.id} onClose={() => setEcView(null)} onRefresh={() => {}} />
      )}
      {detailEntityId && (detailEntityType === 'part' || detailEntityType === 'assembly') && (
        <PartDetailModal
          masterId={detailData?.master_id || ''}
          revisionId={detailEntityId}
          open={!!detailEntityId}
          onClose={() => { setDetailEntityId(null); setDetailEntityType(null); setDetailData(null); }}
        />
      )}
      {detailEntityId && detailEntityType === 'document' && (
        <Modal
          open={!!detailEntityId}
          title="图文档详情"
          onClose={() => { setDetailEntityId(null); setDetailEntityType(null); setDetailData(null); setDetailCustomDefs([]); setDetailCustomValues({}); }}
          width="full"
        >
          {detailLoading ? (
            <div className="flex items-center justify-center py-8 text-gray-400">加载中...</div>
          ) : detailData ? (
            <DocumentDetailContent doc={detailData} customFieldDefs={detailCustomDefs} customFieldValues={detailCustomValues}
              onArchivePreview={(attId, fileName) => setArchivePreview({ attId, fileName })} />
          ) : null}
        </Modal>
      )}
      {archivePreview && (
        <ArchiveTreeModal
          open={!!archivePreview}
          onClose={() => setArchivePreview(null)}
          attachmentId={archivePreview.attId}
          fileName={archivePreview.fileName}
        />
      )}
      {showPartPicker && (
        <AssemblyPartPicker
          open={showPartPicker}
          onClose={() => setShowPartPicker(false)}
          dataMode="parts"
          onConfirm={(items) => {
            addLinks(items.map((it) => ({ entity_type: 'part', entity_id: it.child_id })));
            setShowPartPicker(false);
          }}
        />
      )}
      {showDocPicker && (
        <DocumentPicker
          open={showDocPicker}
          onClose={() => setShowDocPicker(false)}
          onConfirm={(items) => {
            addLinks(items.map((it) => ({ entity_type: 'document', entity_id: it.document_id })));
            setShowDocPicker(false);
          }}
        />
      )}
      {showConfigPicker && (
        <ConfigItemPicker
          open={showConfigPicker}
          onClose={() => setShowConfigPicker(false)}
          onConfirm={(item) => {
            addLinks([{ entity_type: 'config_item', entity_id: item.id }]);
            setShowConfigPicker(false);
          }}
        />
      )}
      <ECPicker open={showECPicker} onClose={() => setShowECPicker(false)} onConfirm={(items) => addLinks(items)} />
    </Modal>
  );
```

- [ ] **Step 1.2: 将 `tab` 状态类型从 `'info' | 'links' | 'logs'` 改为 `'info' | 'links' | 'comments' | 'logs'`**

找到第 59 行：
```tsx
const [tab, setTab] = useState<'info' | 'links' | 'logs'>('info');
```

替换为：
```tsx
const [tab, setTab] = useState<'info' | 'links' | 'comments' | 'logs'>('info');
```

- [ ] **Step 1.3: 修改 Modal 的 onClose 行为**

原代码将 task.code 和 task.name 拼接作为标题显示在 Modal title 中。新的 title 统一为 "编辑任务" 或 "新建任务"。找到第 274 行的 Modal 行，确认已用新代码替换。

- [ ] **Step 1.4: 构建验证骨架**

```powershell
cd frontend; if ($?) { npx tsc --noEmit --pretty 2>&1 | Select-Object -First 20 }
```

预期：有 JSX 结构语法错误（TAB 内容区为空），正常，后续任务填充。

---

### Task 2: 实现 TAB1「基本信息」内容区

**Files:**
- Modify: `frontend/src/pages/Project/TaskEditModal.tsx`

**目标**: 在 TAB1 内容区填充：负责人、计划周期（四列）、描述、任务依赖。新建模式下也复用相同表单（无 TAB 包裹直接显示）。

- [ ] **Step 2.1: 提取 TAB1 内容为 JSX 片段（用于复用）**

在组件顶部（state 声明之后、return 之前），不需要新建函数，直接在 JSX 中写入。找到骨架中 `{/* TAB 内容接后续任务填充 */}` 的位置，替换为：

```tsx
{tab === 'info' && (
  <div className="space-y-4">
    {/* 负责人 */}
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-2">负责人</h4>
      <div className="w-64">
        <select value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}
                className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
          <option value="">未指派</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.real_name}</option>)}
        </select>
      </div>
    </div>

    {/* 计划周期（四列卡片栅格） */}
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-2">计划周期</h4>
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          <div className="text-xs text-gray-500 mb-0.5">计划开始</div>
          <input type="date" value={form.planned_start} onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
                 className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          <div className="text-xs text-gray-500 mb-0.5">计划完成</div>
          <input type="date" value={form.planned_end} onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
                 className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
        </div>
        <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          <div className="text-xs text-gray-500 mb-0.5">实际开始</div>
          <div className="text-sm text-gray-400 py-1">{form.actual_start || '—'}</div>
        </div>
        <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
          <div className="text-xs text-gray-500 mb-0.5">实际完成</div>
          <div className="text-sm text-gray-400 py-1">{form.actual_end || '—'}</div>
        </div>
      </div>
    </div>

    {/* 描述 */}
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-2">描述</h4>
      <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full text-sm px-3 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
                rows={3} placeholder="可选" />
    </div>

    {/* 任务依赖 */}
    {task?.id && (
      <div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <h4 className="text-sm font-semibold text-gray-700">任务依赖</h4>
          {canEditDeps && (
            <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
              <select className="border rounded px-2 py-1 text-sm" value={depForm.role}
                onChange={(e) => setDepForm({ ...depForm, role: e.target.value as 'pred' | 'succ' })}>
                <option value="pred">本任务为前置 →</option>
                <option value="succ">本任务为后置 ←</option>
              </select>
              <div className="relative" ref={taskDropRef}>
                <input
                  type="text"
                  className="border rounded px-2 py-1 text-sm w-48"
                  placeholder="搜索任务…"
                  value={depForm.other
                    ? (allTasks.find(t => t.id === depForm.other)
                        ? `${allTasks.find(t => t.id === depForm.other)!.code} ${allTasks.find(t => t.id === depForm.other)!.name}`
                        : depTaskSearch)
                    : depTaskSearch}
                  onChange={(e) => {
                    setDepTaskSearch(e.target.value);
                    setDepForm({ ...depForm, other: '' });
                    setTaskDropOpen(true);
                  }}
                  onFocus={() => setTaskDropOpen(true)}
                />
                {taskDropOpen && (
                  <div className="absolute z-50 mt-1 w-72 bg-white border border-gray-200 rounded shadow-lg max-h-48 overflow-y-auto">
                    {allTasks
                      .filter(t => {
                        const q = depTaskSearch.toLowerCase();
                        return !q || t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
                      })
                      .map(t => (
                        <div
                          key={t.id}
                          className="px-3 py-1.5 text-sm cursor-pointer hover:bg-primary-50 hover:text-primary-700"
                          onMouseDown={() => {
                            setDepForm({ ...depForm, other: t.id });
                            setDepTaskSearch('');
                            setTaskDropOpen(false);
                          }}
                        >
                          <span className="font-mono text-xs text-gray-500 mr-1">{t.code}</span>{t.name}
                        </div>
                      ))}
                    {allTasks.filter(t => {
                      const q = depTaskSearch.toLowerCase();
                      return !q || t.code.toLowerCase().includes(q) || t.name.toLowerCase().includes(q);
                    }).length === 0 && (
                      <div className="px-3 py-2 text-sm text-gray-400">无匹配任务</div>
                    )}
                  </div>
                )}
              </div>
              <select className="border rounded px-2 py-1 text-sm" value={depForm.type}
                onChange={(e) => setDepForm({ ...depForm, type: e.target.value as DepType })}>
                {(['FS', 'SS', 'FF', 'SF'] as DepType[]).map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="number" className="border rounded px-2 py-1 text-sm w-20" placeholder="lag" value={depForm.lag}
                onChange={(e) => setDepForm({ ...depForm, lag: Number(e.target.value) })} />
              <button className="px-2 py-1 text-sm bg-primary-600 text-white rounded"
                disabled={!depForm.other}
                onClick={async () => {
                  const pred = depForm.role === 'pred' ? task.id : depForm.other;
                  const succ = depForm.role === 'pred' ? depForm.other : task.id;
                  try {
                    await projectApi.addDep(projectId, { predecessor_id: pred, successor_id: succ, dep_type: depForm.type, lag_days: depForm.lag });
                    setDepForm({ ...depForm, other: '', lag: 0 });
                    setDepTaskSearch('');
                    loadDeps();
                  } catch (err: any) {
                    alert(err?.response?.data?.detail || '添加依赖失败');
                  }
                }}>添加依赖</button>
            </div>
          )}
        </div>
        <ul className="space-y-1 mb-2">
          {deps.map((d) => {
            const isPred = d.predecessor_id === task.id;
            const otherId = isPred ? d.successor_id : d.predecessor_id;
            const other = allTasks.find((t) => t.id === otherId);
            return (
              <li key={d.id} className="flex items-center gap-2 text-sm">
                <span className={`px-1.5 py-0.5 rounded text-xs ${d.is_violation ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-600'}`}>{d.dep_type}</span>
                <span className="text-gray-500">{isPred ? '后置→' : '←前置'}</span>
                <span className="truncate">{other ? `${other.code} ${other.name}` : otherId}</span>
                {d.lag_days ? <span className="text-gray-400">lag {d.lag_days}d</span> : null}
                {canEditDeps && (
                  <button className="ml-auto text-xs text-red-500" onClick={async () => { await projectApi.removeDep(projectId, d.id); loadDeps(); }}>删除</button>
                )}
              </li>
            );
          })}
          {deps.length === 0 && <li className="text-xs text-gray-400">暂无依赖</li>}
        </ul>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 2.2: 在新建任务模式下填入相同表单**

找到骨架中新建任务占位 `{/* 负责人、计划周期、描述 - 接 Task 2 */}`，替换为与 TAB1 相同的表单内容（不包括任务依赖，因为新建任务还没有 task.id）。

```tsx
<div className="space-y-4">
  {/* 负责人 */}
  <div>
    <h4 className="text-sm font-semibold text-gray-700 mb-2">负责人</h4>
    <div className="w-64">
      <select value={form.assignee_id} onChange={(e) => setForm({ ...form, assignee_id: e.target.value })}
              className="w-full text-sm px-2 py-1.5 border border-gray-200 rounded bg-white focus:outline-none focus:ring-2 focus:ring-primary-500">
        <option value="">未指派</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.real_name}</option>)}
      </select>
    </div>
  </div>

  {/* 计划周期（四列卡片栅格） */}
  <div>
    <h4 className="text-sm font-semibold text-gray-700 mb-2">计划周期</h4>
    <div className="grid grid-cols-4 gap-3">
      <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
        <div className="text-xs text-gray-500 mb-0.5">计划开始</div>
        <input type="date" value={form.planned_start} onChange={(e) => setForm({ ...form, planned_start: e.target.value })}
               className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
      </div>
      <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
        <div className="text-xs text-gray-500 mb-0.5">计划完成</div>
        <input type="date" value={form.planned_end} onChange={(e) => setForm({ ...form, planned_end: e.target.value })}
               className="w-full text-sm px-2 py-1 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500" />
      </div>
      <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
        <div className="text-xs text-gray-500 mb-0.5">实际开始</div>
        <div className="text-sm text-gray-400 py-1">—</div>
      </div>
      <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
        <div className="text-xs text-gray-500 mb-0.5">实际完成</div>
        <div className="text-sm text-gray-400 py-1">—</div>
      </div>
    </div>
  </div>

  {/* 描述 */}
  <div>
    <h4 className="text-sm font-semibold text-gray-700 mb-2">描述</h4>
    <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
              rows={3} placeholder="可选" />
  </div>
</div>
```

- [ ] **Step 2.3: 检查状态栏部分的代码**

在 `useEffect` 中 `loadTaskLogs` 依赖的 tab 值现在需要响应 `'logs'`：

原代码第 268 行附近：
```tsx
useEffect(() => {
    if (tab === 'logs' && task) loadTaskLogs();
  }, [tab, task]);
```

确认 `tab` 切换为 `'logs'` 时仍能正确触发。无需修改（已有此逻辑）。

- [ ] **Step 2.4: 构建验证**

```powershell
cd frontend; if ($?) { npx tsc --noEmit --pretty 2>&1 | Select-Object -First 20 }
```

预期：仅有未使用变量警告，无类型错误。

---

### Task 3: 实现 TAB2「关联对象」和 TAB3「评论」

**Files:**
- Modify: `frontend/src/pages/Project/TaskEditModal.tsx`

**目标**: 将原来的关联对象 JSX 移到 `tab === 'links'` 条件内，将原来评论 JSX 移到 `tab === 'comments'` 条件内。逻辑完全不变。

- [ ] **Step 3.1: 在 TAB 内容区添加 TAB2「关联对象」**

在 TAB 内容区 `{tab === 'info' && (...)}` 之后添加（原关联对象 JSX 从第 358-413 行移入）：

```tsx
{tab === 'links' && (
  <div className="space-y-4">
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <h4 className="text-sm font-semibold text-gray-700">关联对象</h4>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setShowPartPicker(true)} className="text-xs px-2 py-1 rounded bg-primary-50 text-primary-700 hover:bg-primary-100">零部件 +</button>
          <button onClick={() => setShowConfigPicker(true)} className="text-xs px-2 py-1 rounded bg-teal-50 text-teal-700 hover:bg-teal-100">构型项 +</button>
          <button onClick={() => setShowECPicker(true)} className="text-xs px-2 py-1 rounded bg-amber-50 text-amber-700 hover:bg-amber-100">EC +</button>
          <button onClick={() => setShowDocPicker(true)} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100">图文档 +</button>
        </div>
      </div>
      {links.length > 0 ? (
        <div className="border border-gray-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200 sticky top-0 z-10">
              <tr>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 w-20 whitespace-nowrap">类型</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 w-36 whitespace-nowrap">件号</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">名称</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">规格/备注</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-gray-500 w-12">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {links.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => {
                      if (l.entity_type === 'part' || l.entity_type === 'assembly') {
                        setDetailEntityId(l.entity_id);
                        setDetailEntityType(l.entity_type);
                        setDetailData({ master_id: (l as any).entity_master_id || '' });
                      } else {
                        handleViewEntity(l.entity_type, l.entity_id);
                      }
                    }}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span className={`text-xs px-1.5 py-0.5 rounded ${LINK_COLOR[l.entity_type] ?? 'bg-gray-100 text-gray-600'}`}>{LINK_LABEL[l.entity_type]}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-gray-700 whitespace-nowrap">{l.entity_code || '—'}</td>
                  <td className="px-3 py-2 text-gray-700">{l.entity_name || '—'}</td>
                  <td className="px-3 py-2 text-gray-500">{l.entity_spec || l.entity_remark || '—'}</td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => removeLink(l.id)} className="text-gray-400 hover:text-red-600 text-sm">×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-xs text-gray-400 py-4">暂无关联</div>
      )}
    </div>
  </div>
)}
```

- [ ] **Step 3.2: 在 TAB 内容区添加 TAB3「评论」**

在 TAB2 之后添加（原评论 JSX 从第 520-548 行移入，调整标题样式）：

```tsx
{tab === 'comments' && (
  <div className="space-y-3">
    <h4 className="text-sm font-semibold text-gray-700">评论</h4>
    <div className="space-y-2 mb-3 max-h-48 overflow-y-auto">
      {comments.map((c) => (
        <div key={c.id} className="flex gap-2 text-sm">
          <div className="w-7 h-7 rounded-full bg-primary-50 text-primary-700 flex items-center justify-center text-xs shrink-0">
            {c.user_name?.[0] || '?'}
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{c.user_name}</span>
              <span className="text-xs text-gray-400">{formatDateTime(c.created_at)}</span>
              <div className="flex-1" />
              <button onClick={() => removeComment(c.id)} className="text-xs text-gray-400 hover:text-red-600">删除</button>
            </div>
            <div className="text-gray-700 whitespace-pre-wrap">{c.content}</div>
          </div>
        </div>
      ))}
      {comments.length === 0 && <div className="text-xs text-gray-400 py-4">暂无评论</div>}
    </div>
    <div className="flex gap-2">
      <input value={newComment} onChange={(e) => setNewComment(e.target.value)}
             onKeyDown={(e) => { if (e.key === 'Enter') submitComment(); }}
             placeholder="写评论…(项目成员均可评论)"
             className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm" />
      <button onClick={submitComment} className="px-4 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 text-sm">发送</button>
    </div>
  </div>
)}
```

- [ ] **Step 3.3: 构建验证**

```powershell
cd frontend; if ($?) { npx tsc --noEmit --pretty 2>&1 | Select-Object -First 20 }
```

预期：无类型错误。

---

### Task 4: 实现 TAB4「操作日志」

**Files:**
- Modify: `frontend/src/pages/Project/TaskEditModal.tsx`

**目标**: 将原来的操作日志 JSX 移到 `tab === 'logs'` 条件内。

- [ ] **Step 4.1: 在 TAB 内容区添加 TAB4**

在 TAB3 之后添加（原操作日志 JSX 从第 552-588 行移入，去掉多余的外层 max-h）：

```tsx
{tab === 'logs' && (
  <div>
    {taskLogsLoading ? (
      <div className="text-center text-gray-400 py-8">加载中...</div>
    ) : taskLogs.length === 0 ? (
      <div className="text-center text-gray-400 py-8">暂无操作记录</div>
    ) : (
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b sticky top-0 z-10">
          <tr>
            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">时间</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">用户</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500 whitespace-nowrap">操作</th>
            <th className="text-left px-3 py-2 text-xs font-medium text-gray-500">详情</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {taskLogs.map((l) => (
            <tr key={l.id}>
              <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{formatDateTime(l.created_at)}</td>
              <td className="px-3 py-2">{l.username}</td>
              <td className="px-3 py-2">
                <span className={`px-2 py-0.5 text-xs rounded-full ${
                  l.action === '创建任务' ? 'bg-green-100 text-green-800' :
                  l.action === '删除任务' ? 'bg-red-100 text-red-800' :
                  l.action === '任务状态变更' ? 'bg-blue-100 text-blue-800' :
                  'bg-gray-100 text-gray-700'
                }`}>{l.action}</span>
              </td>
              <td className="px-3 py-2 text-gray-500">{l.detail || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
)}
```

- [ ] **Step 4.2: 构建验证**

```powershell
cd frontend; if ($?) { npx tsc --noEmit --pretty 2>&1 | Select-Object -First 20 }
```

预期：无类型错误。

---

### Task 5: 清理和最终验证

**Files:**
- Modify: `frontend/src/pages/Project/TaskEditModal.tsx`

- [ ] **Step 5.1: 检查是否有残留的旧 JSX 代码段未被移除**

检查文件中是否仍存在以下旧结构残留：
- 原第 276-289 行的旧 TAB 导航栏（已替换为新骨架中的 TAB 导航）
- 原第 290-355 行的旧基本信息表单（字段已迁移到核心信息区 + TAB1）
- 原第 416-551 行的旧依赖+评论区块（已迁移到 TAB1/TAB3）
- 原第 590-628 行的旧底部操作栏（已保留在新骨架中）

所有这些旧代码段需要移除。旧底部操作栏已在新骨架中直接写了新代码，因此旧的需删除。旧子 Modal（第 630 行之后）保持不变。

- [ ] **Step 5.2: 编译检查**

```powershell
cd frontend; if ($?) { npx tsc --noEmit --pretty }
```

预期：0 errors。

- [ ] **Step 5.3: 构建前端**

```powershell
cd frontend; if ($?) { npm run build }
```

预期：构建成功，无错误。

- [ ] **Step 5.4: 重启 Nginx**

```powershell
docker-compose up -d --force-recreate nginx
```

---

### Task 6: 功能验证清单

所有操作在浏览器中验证：

- [ ] **6.1 新建任务**: 点击新建任务，Modal 打开 → 核心信息区显示 5 张卡片（编号显示"—"）→ 下方直接显示负责人/计划周期/描述表单（无 TAB）→ 填写后保存成功
- [ ] **6.2 编辑任务**: 点击已有任务 → Modal 打开 → 核心信息区显示编号/名称/类型/状态/优先级 → 下方 TAB 区显示 4 个 TAB → 默认选中「基本信息」
- [ ] **6.3 TAB 切换**: 依次点击基本信息→关联对象→评论→操作记录，各 TAB 内容正确显示，核心信息区始终可见不滚动
- [ ] **6.4 状态操作**: 底部操作栏左侧按钮根据任务状态正确显示 → 点击开始/暂停/完成/恢复 → 状态和实际日期正确更新
- [ ] **6.5 关联对象**: 切换到「关联对象」TAB → 添加零部件/构型项/EC/图文档 → 列表正确显示 → 删除正常
- [ ] **6.6 评论**: 切换到「评论」TAB → 添加/删除评论正常
- [ ] **6.7 操作日志**: 切换到「操作记录」TAB → 操作日志列表正确加载
- [ ] **6.8 任务依赖**: 切换到「基本信息」TAB → 添加/删除依赖正常 → 下拉搜索任务正常
- [ ] **6.9 二次编辑**: 保存后关闭 Modal → 再次点击任务打开 → 所有数据正确回显
