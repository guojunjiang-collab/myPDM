import React from 'react';
import { useState, useEffect } from 'react';
import { Modal } from './Modal';
import { attachmentApi, mediaApi } from '../services/api';
import type { ArchiveTreeNode, ArchiveTreeResponse } from '../types';

interface ArchiveTreeModalProps {
  open: boolean;
  onClose: () => void;
  attachmentId: string;
  fileName: string;
}

/** 文件大小格式化 */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

/** 构建提取/预览 URL */
function extractUrl(attId: string, filePath: string, token: string, inline: boolean): string {
  return `/api/v2/attachments/${attId}/extract-file?path=${encodeURIComponent(filePath)}&token=${encodeURIComponent(token)}&disposition=${inline ? 'inline' : 'attachment'}`;
}

/** 判断文件是否可预览 */
function canPreview(fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  return ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'txt', 'md', 'csv', 'json', 'xml', 'stp', 'step'].includes(ext);
}

/** 递归渲染树节点 */
function TreeNodeItem({ node, depth, attId, token }: { node: ArchiveTreeNode; depth: number; attId: string; token: string }) {
  const [expanded, setExpanded] = useState(depth < 1);
  const isDir = node.type === 'dir';
  const hasChildren = isDir && (node.children?.length ?? 0) > 0;

  return (
    <React.Fragment>
      <tr className={`hover:bg-gray-50 ${isDir ? 'cursor-pointer' : ''}`}
        onClick={() => { if (isDir) setExpanded(!expanded); }}>
        <td className="px-3 py-1.5 text-xs whitespace-nowrap" style={{ paddingLeft: `${16 + depth * 20}px` }}>
          <span className="inline-flex items-center gap-1">
            {hasChildren && (<span className="text-gray-400 w-3 inline-block text-center">{expanded ? '▼' : '▶'}</span>)}
            {!hasChildren && isDir && <span className="w-3 inline-block" />}
            <span className={isDir ? 'font-medium' : ''}>{isDir ? '📁 ' : '📄 '}{node.name}</span>
          </span>
        </td>
        <td className="px-2 py-1.5 text-xs text-gray-500 w-20 text-right">
          {isDir ? '-' : formatSize(node.size)}
        </td>
        <td className="px-2 py-1.5 text-center w-24" onClick={e => e.stopPropagation()}>
          {!isDir && (
            <span className="inline-flex gap-1">
              <a href={extractUrl(attId, node.path || node.name, token, false)} target="_blank" rel="noreferrer"
                 className="text-blue-600 hover:text-blue-800 text-xs" title="下载">
                下载
              </a>
              {canPreview(node.name) && (
                <>
                  <span className="text-gray-300">|</span>
                  <a href={extractUrl(attId, node.path || node.name, token, true)} target="_blank" rel="noreferrer"
                     className="text-green-600 hover:text-green-800 text-xs" title="预览">
                    预览
                  </a>
                </>
              )}
            </span>
          )}
        </td>
      </tr>
      {expanded && hasChildren && node.children!.map((child, i) => (
        <TreeNodeItem key={`${child.name}-${i}`} node={child} depth={depth + 1} attId={attId} token={token} />
      ))}
    </React.Fragment>
  );
}

export default function ArchiveTreeModal({
  open, onClose, attachmentId, fileName
}: ArchiveTreeModalProps) {
  const [data, setData] = useState<ArchiveTreeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [extractToken, setExtractToken] = useState('');

  useEffect(() => {
    if (!open || !attachmentId) return;
    setLoading(true);
    setError('');
    setData(null);
    setExtractToken('');

    Promise.all([
      mediaApi.token(attachmentId, 'archive-tree'),
      mediaApi.token(attachmentId, 'extract-file'),
    ])
      .then(([treeToken, exToken]) => {
        setExtractToken(exToken);
        return attachmentApi.archiveTree(attachmentId, treeToken);
      })
      .then(res => setData(res.data))
      .catch(err => setError(err?.response?.data?.detail || '读取压缩包失败'))
      .finally(() => setLoading(false));
  }, [open, attachmentId]);

  return (
    <Modal open={open} title={`压缩包预览：${fileName}`} onClose={onClose} width="lg">
      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">读取中...</div>
      ) : error ? (
        <div className="py-8 text-center text-sm text-red-500">{error}</div>
      ) : data ? (
        <>
          <div className="flex gap-4 mb-3 px-2 text-xs text-gray-500">
            <span>共 {data.total_files} 个文件</span>
            <span>总大小 {formatSize(data.total_size)}</span>
          </div>
          <div className="border rounded-lg overflow-auto max-h-[60vh]">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500 border-b">
                    <th className="px-3 py-1.5 text-left">名称</th>
                    <th className="px-2 py-1.5 text-right w-20">大小</th>
                    <th className="px-2 py-1.5 text-center w-24">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.tree.map((node, i) => (
                    <TreeNodeItem key={i} node={node} depth={0} attId={attachmentId} token={extractToken} />
                  ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </Modal>
  );
}
