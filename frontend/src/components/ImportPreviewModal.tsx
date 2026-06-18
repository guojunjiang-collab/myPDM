import { useState } from 'react';
import { Modal } from './Modal';
import type { ImportPreview, ImportRow } from '../services/importExport';

interface ImportPreviewModalProps {
  open: boolean;
  preview: ImportPreview | null;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}

export default function ImportPreviewModal({
  open,
  preview,
  loading,
  onClose,
  onConfirm,
}: ImportPreviewModalProps) {
  const [executing, setExecuting] = useState(false);

  if (!preview) return null;

  const rows = preview.rows;
  const newCount = rows.filter((r) => r.status === '新增').length;
  const updateCount = rows.filter((r) => r.status === '更新').length;
  const errorCount = rows.filter((r) => r.status === '错误').length;

  const getTypeLabel = () => {
    switch (preview.type) {
      case 'part':
        return '零件';
      case 'assembly':
        return '部件';
      case 'document':
        return '图文档';
      case 'configuration_item':
        return '构型项';
      case 'configuration_profile':
        return '构型配置';
      case 'ecr':
        return 'ECR';
      case 'eco':
        return 'ECO';
      case 'user':
        return '用户';
      case 'dashboard':
        return '仪表盘';
    }
  };

  const getSummaryLine = () => {
    let text = `共 ${rows.length} 条（新增 ${newCount} / 更新 ${updateCount}`;
    if (errorCount > 0) text += ` / 错误 ${errorCount}`;
    text += '）';
    return text;
  };

  const handleConfirm = async () => {
    setExecuting(true);
    try {
      await onConfirm();
    } finally {
      setExecuting(false);
    }
  };

  const renderStatusBadge = (row: ImportRow) => {
    if (row.status === '新增') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-800">
          🆕 新增
        </span>
      );
    }
    if (row.status === '更新') {
      return (
        <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
          ✏️ 更新
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-800">
        ❌ 错误
      </span>
    );
  };

  return (
    <Modal open={open} title={`${getTypeLabel()}导入预览`} onClose={onClose} width="full" zIndex={60}>
      <div className="space-y-4">
        {/* 摘要 */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-gray-700 font-medium">{getSummaryLine()}</span>
          {preview.docWarnings !== undefined && preview.docWarnings > 0 && (
            <span className="text-sm text-orange-600">
              ⚠️ {preview.docWarnings} 个关联图文档未找到
            </span>
          )}
          {preview.bomFiles !== undefined && (
            <span className="text-sm text-gray-600">
              BOM文件 {preview.bomFiles} 个
              {preview.bomMatched !== undefined && `（匹配 ${preview.bomMatched} 个）`}
            </span>
          )}
          {preview.docRelationCount !== undefined && preview.docRelationCount > 0 && (
            <span className="text-sm text-gray-600">
              关联图文档 {preview.docRelationCount} 条
            </span>
          )}
          {/* 构型项统计 */}
          {preview.type === 'configuration_item' && (
            <>
              {preview.partRelationCount !== undefined && preview.partRelationCount > 0 && (
                <span className="text-sm text-gray-600">
                  关联零部件 {preview.partRelationCount} 个
                  {preview.partWarnings !== undefined && preview.partWarnings > 0 && (
                    <span className="text-orange-600">（未找到 {preview.partWarnings} 个）</span>
                  )}
                </span>
              )}
              {preview.childRelationCount !== undefined && preview.childRelationCount > 0 && (
                <span className="text-sm text-gray-600">
                  子构型项 {preview.childRelationCount} 个
                  {preview.childWarnings !== undefined && preview.childWarnings > 0 && (
                    <span className="text-orange-600">（未找到 {preview.childWarnings} 个）</span>
                  )}
                </span>
              )}
              {preview.orphanParentCodes && preview.orphanParentCodes.length > 0 && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mt-1">
                  ⚠️ 子构型项 sheet 中有 {preview.orphanParentCodes.length} 个父构型号不存在于构型项清单中，关联将丢失。
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs">查看详情</summary>
                    <div className="text-xs mt-1 max-h-20 overflow-y-auto">{preview.orphanParentCodes.join('、')}</div>
                  </details>
                </div>
              )}
              {preview.orphanChildCodes && preview.orphanChildCodes.length > 0 && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mt-1">
                  ⚠️ 子构型项 sheet 中有 {preview.orphanChildCodes.length} 个子构型号不存在于构型项清单中，关联将丢失。
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs">查看详情</summary>
                    <div className="text-xs mt-1 max-h-20 overflow-y-auto">{preview.orphanChildCodes.join('、')}</div>
                  </details>
                </div>
              )}
            </>
          )}
          {/* 构型配置统计 */}
          {preview.type === 'configuration_profile' && (
            <>
              {preview.profileItemCount !== undefined && preview.profileItemCount > 0 && (
                <span className="text-sm text-gray-600">清单项 {preview.profileItemCount} 个</span>
              )}
              {preview.ciWarnings !== undefined && preview.ciWarnings > 0 && (
                <span className="text-sm text-orange-600">⚠️ {preview.ciWarnings} 个关联构型项未找到</span>
              )}
            </>
          )}
          {/* ECR 统计 */}
          {preview.type === 'ecr' && (
            <>
              {preview.affectedCount !== undefined && preview.affectedCount > 0 && (
                <span className="text-sm text-gray-600">
                  受影响对象 {preview.affectedCount} 个
                  {preview.affectedWarnings !== undefined && preview.affectedWarnings > 0 && (
                    <span className="text-orange-600">（未找到 {preview.affectedWarnings} 个）</span>
                  )}
                </span>
              )}
              {preview.reviewerCount !== undefined && preview.reviewerCount > 0 && (
                <span className="text-sm text-gray-600">
                  审批人 {preview.reviewerCount} 个
                  {preview.reviewerWarnings !== undefined && preview.reviewerWarnings > 0 && (
                    <span className="text-orange-600">（未找到 {preview.reviewerWarnings} 个）</span>
                  )}
                </span>
              )}
              {preview.ccWarnings !== undefined && preview.ccWarnings > 0 && (
                <span className="text-sm text-orange-600">⚠️ {preview.ccWarnings} 个知会人未找到</span>
              )}
            </>
          )}
          {/* ECO 统计 */}
          {preview.type === 'eco' && (
            <>
              {preview.execItemCount !== undefined && preview.execItemCount > 0 && (
                <span className="text-sm text-gray-600">
                  执行明细 {preview.execItemCount} 个
                  {preview.execItemWarnings !== undefined && preview.execItemWarnings > 0 && (
                    <span className="text-orange-600">（未找到 {preview.execItemWarnings} 个）</span>
                  )}
                </span>
              )}
              {preview.reviewerCount !== undefined && preview.reviewerCount > 0 && (
                <span className="text-sm text-gray-600">
                  审批人 {preview.reviewerCount} 个
                  {preview.reviewerWarnings !== undefined && preview.reviewerWarnings > 0 && (
                    <span className="text-orange-600">（未找到 {preview.reviewerWarnings} 个）</span>
                  )}
                </span>
              )}
              {preview.ecrWarnings !== undefined && preview.ecrWarnings > 0 && (
                <span className="text-sm text-orange-600">⚠️ {preview.ecrWarnings} 个来源ECR未找到</span>
              )}
              {preview.ccWarnings !== undefined && preview.ccWarnings > 0 && (
                <span className="text-sm text-orange-600">⚠️ {preview.ccWarnings} 个知会人未找到</span>
              )}
            </>
          )}
        </div>

        {/* 表格 */}
        <div className="border rounded-lg overflow-hidden max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-20">状态</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">件号/编号</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">名称</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium w-16">版本</th>
                <th className="px-3 py-2 text-left text-gray-500 font-medium">备注/说明</th>
                {(['configuration_item', 'configuration_profile', 'ecr', 'eco'] as ImportPreview['type'][]).includes(preview.type) && (
                  <th className="px-3 py-2 text-left text-gray-500 font-medium w-24">关联</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((row, idx) => (
                <tr
                  key={idx}
                  className={`${
                    row.status === '错误'
                      ? 'bg-red-50'
                      : row.status === '新增'
                        ? 'bg-green-50/30'
                        : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="px-3 py-2">{renderStatusBadge(row)}</td>
                  <td className="px-3 py-2 font-medium">{row.code || '-'}</td>
                  <td className="px-3 py-2">{row.name || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">{row.version || '-'}</td>
                  <td className="px-3 py-2 text-gray-500">
                    {row.error ? (
                      <span className="text-red-600">{row.error}</span>
                    ) : row.remark ? (
                      row.remark
                    ) : row._bomChildren !== undefined && row._bomChildren > 0 ? (
                      <span className="text-gray-600">{row._bomChildren} 个子项</span>
                    ) : (
                      '-'
                    )}
                  </td>
                  {(['configuration_item', 'configuration_profile', 'ecr', 'eco'] as ImportPreview['type'][]).includes(preview.type) && (
                    <td className="px-3 py-2 text-gray-500 text-xs">
                      {preview.type === 'configuration_item' && (
                        <span className="space-x-1">
                          {row._partCount !== undefined && <span>零部件×{row._partCount}</span>}
                          {row._childCount !== undefined && <span>子项×{row._childCount}</span>}
                          {row._docCount !== undefined && <span>文档×{row._docCount}</span>}
                        </span>
                      )}
                      {preview.type === 'configuration_profile' && (
                        <span className="space-x-1">
                          <span>{row._ciCode ? `CI: ${row._ciCode}` : '无关联构型项'}</span>
                          {row._itemCount !== undefined && <span>清单项×{row._itemCount}</span>}
                        </span>
                      )}
                      {(preview.type === 'ecr' || preview.type === 'eco') && (
                        <span className="space-x-1">
                          {row._affectedCount !== undefined && <span>影响×{row._affectedCount}</span>}
                          {row._reviewerCount !== undefined && <span>审批×{row._reviewerCount}</span>}
                          {row._execCount !== undefined && <span>执行×{row._execCount}</span>}
                        </span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 说明 */}
        <div className="text-xs text-gray-400 space-y-1">
          <p>• 🆕 新增：系统中不存在该记录，将新建</p>
          <p>• ✏️ 更新：系统中已存在该记录，将覆盖更新</p>
          <p>• ❌ 错误：必填字段缺失，将被跳过</p>
          <p>• 导入只做新增和更新，不会删除已有数据</p>
        </div>

        {/* 按钮 */}
        <div className="flex justify-end gap-2 pt-2 border-t">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 text-sm"
            disabled={executing}
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={executing || rows.length === 0}
            className={`px-4 py-2 rounded-lg text-white text-sm ${
              executing
                ? 'bg-primary-400 cursor-not-allowed'
                : 'bg-primary-600 hover:bg-primary-700'
            }`}
          >
            {executing ? '导入中...' : `确认导入 (${rows.filter((r) => r.status !== '错误').length}条)`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
