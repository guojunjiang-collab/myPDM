import { useState } from 'react';
import type { useCADBridge } from '../../hooks/useCADBridge';
import type { BOMRow } from './CADBOMMatchTable';
import { flattenTree } from './flattenTree';

interface Props {
  bridge: ReturnType<typeof useCADBridge>;
  onAssemblyLoaded: (rows: BOMRow[]) => void;
  onClose: () => void;
}

export function CADConnectStep({ bridge, onAssemblyLoaded, onClose }: Props) {
  const [catiaDetected, setCatiaDetected] = useState(false);
  const [docInfo, setDocInfo] = useState<{ name: string; type: string } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState('');

  const handleDetect = async () => {
    setDetecting(true);
    setError('');
    try {
      const status = await bridge.detectCAD();
      setCatiaDetected(status.active && !!status.has_document);
      if (status.active && status.has_document) {
        setDocInfo({ name: status.doc_name || '', type: status.doc_type || '' });
      } else if (status.active) {
        setError('CATIA 已运行但未打开任何文档，请打开一个装配体');
      } else {
        setError('未检测到 CATIA 进程，请先启动 CATIA');
      }
    } catch (e: any) {
      setError(e.message || '桥接服务连接失败');
    } finally {
      setDetecting(false);
    }
  };

  const handleLoadAssembly = async () => {
    setLoadingTree(true);
    try {
      const tree = await bridge.readAssemblyTree();
      if (!tree) {
        setError('读取装配结构失败');
        return;
      }
      const rows = flattenTree(tree);
      onAssemblyLoaded(rows);
    } catch (e: any) {
      setError(e.message || '读取装配结构失败');
    } finally {
      setLoadingTree(false);
    }
  };

  return (
    <div className="flex flex-col items-center py-8">
      {/* 状态卡片 */}
      <div className="flex gap-4 mb-6">
        <div className={`flex-1 border rounded-lg p-4 text-center min-w-[200px] ${
          bridge.connected ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200'
        }`}>
          <div className={`font-bold ${bridge.connected ? 'text-green-700' : 'text-gray-400'}`}>
            {bridge.connected ? '桥接服务在线' : '桥接服务离线'}
          </div>
          <div className="text-xs text-gray-500 mt-1">ws://127.0.0.1:9527</div>
        </div>

        <div className={`flex-1 border rounded-lg p-4 text-center min-w-[200px] ${
          catiaDetected ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200'
        }`}>
          <div className={`font-bold ${catiaDetected ? 'text-green-700' : 'text-gray-400'}`}>
            {catiaDetected ? 'CATIA 已连接' : 'CATIA 未连接'}
          </div>
          {docInfo && (
            <div className="text-xs text-gray-500 mt-1">{docInfo.name} ({docInfo.type})</div>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleDetect}
          disabled={detecting}
          className="px-6 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:bg-gray-300 text-sm"
        >
          {detecting ? '检测中...' : '检测 CATIA'}
        </button>

        {catiaDetected && (
          <button
            onClick={handleLoadAssembly}
            disabled={loadingTree}
            className="px-6 py-2 bg-sky-500 text-white rounded-lg hover:bg-sky-600 disabled:bg-gray-300 text-sm"
          >
            {loadingTree ? '读取中...' : '读取装配结构'}
          </button>
        )}
      </div>
    </div>
  );
}
