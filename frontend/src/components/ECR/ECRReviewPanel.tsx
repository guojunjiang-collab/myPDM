import { useState } from 'react';
import type { ECRReviewer, ECRReviewRecord } from '../../types';
import Badge from '../ui/Badge';
import Button from '../ui/Button';
import Textarea from '../ui/Textarea';

interface ECRReviewPanelProps {
  reviewers: ECRReviewer[];
  reviewRecords: ECRReviewRecord[];
  currentUserId: string;
  onReview: (decision: string, comment: string) => void;
  loading: boolean;
}

const decisionConfig: Record<string, { label: string; tone: 'green' | 'red' | 'orange'; borderColor: string; bgColor: string; icon: string }> = {
  approved: { label: '已通过', tone: 'green', borderColor: 'border-l-green-500', bgColor: 'bg-green-50', icon: '✅' },
  rejected: { label: '已驳回', tone: 'red', borderColor: 'border-l-red-500', bgColor: 'bg-red-50', icon: '❌' },
  returned: { label: '已退回', tone: 'orange', borderColor: 'border-l-orange-500', bgColor: 'bg-orange-50', icon: '↩️' },
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
                  <Badge tone={config?.tone ?? 'gray'} label={config?.label ?? '待审批'} />
                  {isCurrentReviewer && isPending && (
                    <Button size="sm"
                      onClick={() => handleStartReview(reviewer.user_id)}
                    >
                      {isExpanded ? '收起' : '审批'}
                    </Button>
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
                    <Textarea
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                      rows={2}
                      className="resize-none"
                      placeholder="输入审批意见（可选）"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm"
                      onClick={() => handleSubmitReview(reviewer.user_id)}
                      disabled={!decision || loading}
                    >
                      {loading ? '提交中...' : '确认审批'}
                    </Button>
                    <Button variant="secondary" size="sm"
                      onClick={() => setActiveReviewerId(null)}
                    >
                      取消
                    </Button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
    </div>
  );
}
