import { useState } from 'react';
import type { ProfileReviewer, ProfileReviewRecord } from '../../types';

interface Props {
  reviewers: ProfileReviewer[];
  records: ProfileReviewRecord[];
  reviewMode?: 'all' | 'any';
  canReview: boolean;
  onReview: (decision: 'approved' | 'rejected' | 'returned', comment: string) => void;
}

const DECISION_LABEL: Record<string, string> = {
  approved: '通过',
  rejected: '驳回',
  returned: '退回',
};

export default function ProfileReviewPanel({ reviewers, records, reviewMode, canReview, onReview }: Props) {
  const [comment, setComment] = useState('');
  const decided = (uid: string) => records.find((r) => r.reviewer_id === uid);

  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-500">
        审批模式：{reviewMode === 'any' ? '或签（任一通过）' : '会签（全部通过）'}
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500">
            <th className="py-1">审批人</th>
            <th>结果</th>
            <th>意见</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          {reviewers.map((rv) => {
            const d = decided(rv.user_id);
            return (
              <tr key={rv.user_id} className="border-t">
                <td className="py-1">{rv.user_name}</td>
                <td>{d ? DECISION_LABEL[d.decision] || d.decision : '待审'}</td>
                <td>{d?.comment || '-'}</td>
                <td>{d?.created_at ? new Date(d.created_at).toLocaleString() : '-'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canReview && (
        <div className="flex flex-col gap-2 border-t pt-2">
          <textarea
            className="border border-gray-200 rounded px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary-500"
            rows={2}
            placeholder="审批意见（可选）"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              className="px-3 py-1 rounded bg-green-600 text-white text-sm hover:bg-green-700"
              onClick={() => onReview('approved', comment)}
            >
              通过
            </button>
            <button
              className="px-3 py-1 rounded bg-red-600 text-white text-sm hover:bg-red-700"
              onClick={() => onReview('rejected', comment)}
            >
              驳回
            </button>
            <button
              className="px-3 py-1 rounded bg-gray-500 text-white text-sm hover:bg-gray-600"
              onClick={() => onReview('returned', comment)}
            >
              退回
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
