import { useState } from 'react';
import type { ECRReviewer, ECRReviewRecord } from '../../types';

interface ECRReviewPanelProps {
  reviewers: ECRReviewer[];
  reviewRecords: ECRReviewRecord[];
  currentUserId: string;
  onReview: (decision: string, comment: string) => void;
  loading: boolean;
}

const decisionConfig: Record<string, { label: string; borderColor: string; bgColor: string; icon: string }> = {
  approved: { label: '已通过', borderColor: 'border-l-green-500', bgColor: 'bg-green-50', icon: '✅' },
  rejected: { label: '已驳回', borderColor: 'border-l-red-500', bgColor: 'bg-red-50', icon: '❌' },
  returned: { label: '已退回', borderColor: 'border-l-orange-500', bgColor: 'bg-orange-50', icon: '↩️' },
};

const pendingConfig = { label: '待审批', borderColor: 'border-l-gray-300', bgColor: 'bg-white', icon: '⏳' };

export function ECRReviewPanel({
  reviewers,
  reviewRecords,
  currentUserId,
  onReview,
  loading,
}: ECRReviewPanelProps) {
  const [activeReviewerId, setActiveReviewerId] = useState<string | null>(null);
  const [decision, setDecision] = useState('');
  const [comment, setComment] = useState('');

  const getReviewRecord = (userId: string): ECRReviewRecord | undefined => {
    return reviewRecords.find((r) => r.reviewer_id === userId);
  };

  const handleStartReview = (userId: string) => {
    setActiveReviewerId(userId === activeReviewerId ? null : userId);
    setDecision('');
    setComment('');
  };

  const handleSubmitReview = (userId: string) => {
    if (!decision) {
      return;
    }
    onReview(decision, comment);
    setActiveReviewerId(null);
    setDecision('');
    setComment('');
  };

  if (!reviewers || reviewers.length === 0) {
    return (
      <div className="text-center text-gray-400 py-8 text-sm">
        👤 暂无审批人
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {reviewers
        .sort((a, b) => a.seq - b.seq)
        .map((reviewer) => {
          const record = getReviewRecord(reviewer.user_id);
          const config = record ? decisionConfig[record.decision] : undefined;
          const isCurrentReviewer = reviewer.user_id === currentUserId;
          const isPending = !record;
          const isExpanded = activeReviewerId === reviewer.user_id;

          return (
            <div
              key={reviewer.user_id}
              className={`border-l-4 rounded-lg border shadow-sm p-4 ${
                config ? `${config.borderColor} ${config.bgColor}` : `${pendingConfig.borderColor} ${pendingConfig.bgColor}`
              }`}
            >
              {/* Reviewer header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-lg">
                    {config ? config.icon : pendingConfig.icon}
                  </span>
                  <div>
                    <div className="font-medium text-sm text-gray-900">
                      {reviewer.user_name}
                    </div>
                    <div className="text-xs text-gray-500">
                      {reviewer.role} · 序号 {reviewer.seq}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 text-xs rounded-full font-medium ${
                      record
                        ? record.decision === 'approved'
                          ? 'bg-green-100 text-green-700'
                          : record.decision === 'rejected'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-orange-100 text-orange-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {config ? config.label : pendingConfig.label}
                  </span>
                  {isCurrentReviewer && isPending && (
                    <button
                      onClick={() => handleStartReview(reviewer.user_id)}
                      className="text-xs px-3 py-1 rounded bg-blue-500 text-white hover:bg-blue-600 transition-colors"
                    >
                      {isExpanded ? '收起' : '审批'}
                    </button>
                  )}
                </div>
              </div>

              {/* Review comment if exists */}
              {record && record.comment && (
                <div className="mt-3 pl-8">
                  <div className="text-xs text-gray-500 mb-1">审批意见：</div>
                  <div className="text-sm text-gray-700 bg-white/60 rounded p-2 border border-gray-100">
                    {record.comment}
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {new Date(record.created_at).toLocaleString('zh-CN')}
                  </div>
                </div>
              )}

              {/* Review form for current user (pending) */}
              {isCurrentReviewer && isPending && isExpanded && (
                <div className="mt-4 pl-8 border-t pt-3">
                  <div className="text-sm font-medium text-gray-700 mb-2">
                    审批决定
                  </div>
                  <div className="flex gap-4 mb-3">
                    {[
                      { value: 'approved', label: '✅ 通过' },
                      { value: 'rejected', label: '❌ 驳回' },
                      { value: 'returned', label: '↩️ 退回' },
                    ].map((opt) => (
                      <label
                        key={opt.value}
                        className="flex items-center gap-1.5 cursor-pointer"
                      >
                        <input
                          type="radio"
                          name={`decision-${reviewer.user_id}`}
                          value={opt.value}
                          checked={decision === opt.value}
                          onChange={(e) => setDecision(e.target.value)}
                          className="text-blue-600"
                        />
                        <span className="text-sm text-gray-700">{opt.label}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mb-3">
                    <label className="block text-xs text-gray-500 mb-1">
                      审批意见
                    </label>
                    <textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={2}
                      className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                      placeholder="输入审批意见（可选）"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleSubmitReview(reviewer.user_id)}
                      disabled={!decision || loading}
                      className="px-4 py-1.5 text-sm rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {loading ? '提交中...' : '确认审批'}
                    </button>
                    <button
                      onClick={() => setActiveReviewerId(null)}
                      className="px-4 py-1.5 text-sm rounded bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
