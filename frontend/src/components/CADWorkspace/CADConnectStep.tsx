import { useState } from 'react';
import type { useCADBridge, CADType } from '../../hooks/useCADBridge';
import type { BOMRow } from './CADBOMMatchTable';
import { flattenTree } from './flattenTree';
import Button from '../ui/Button';
import Select from '../ui/Select';

interface Props {
  bridge: ReturnType<typeof useCADBridge>;
  cadType: CADType;
  onCadTypeChange: (type: CADType) => void;
  onAssemblyLoaded: (rows: BOMRow[]) => void;
  onClose: () => void;
}

export function CADConnectStep({ bridge, cadType, onCadTypeChange, onAssemblyLoaded, onClose }: Props) {
  const [cadDetected, setCadDetected] = useState(false);
  const [docInfo, setDocInfo] = useState<{ name: string; type: string } | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [loadingTree, setLoadingTree] = useState(false);
  const [error, setError] = useState('');

  const cadLabel = cadType === 'catia' ? 'CATIA' : 'SolidWorks';

  const handleDetect = async () => {
    setDetecting(true);
    setError('');
    try {
      const status = await bridge.detectCAD();
      setCadDetected(status.active && !!status.has_document);
      if (status.active && status.has_document) {
        setDocInfo({ name: status.doc_name || '', type: status.doc_type || '' });
      } else if (status.active) {
        setError(`${cadLabel} 已运行但未打开任何文档，请打开一个装配体`);
      } else {
        setError(`未检测到 ${cadLabel} 进程，请先启动 ${cadLabel}`);
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
          cadDetected ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-200'
        }`}>
          <div className={`font-bold ${cadDetected ? 'text-green-700' : 'text-gray-400'}`}>
            {cadDetected ? `${cadLabel} 已连接` : `${cadLabel} 未连接`}
          </div>
          {docInfo && (
            <div className="text-xs text-gray-500 mt-1">{docInfo.name} ({docInfo.type})</div>
          )}
        </div>
      </div>

      <div className="flex gap-3">
        <Select size="xs"
          value={cadType}
          onChange={(e) => onCadTypeChange(e.target.value as CADType)}
        >
          <option value="catia">CATIA V5</option>
          <option value="solidworks">SolidWorks</option>
        </Select>
        <Button
          onClick={handleDetect}
          disabled={detecting}
        >
          {detecting ? '检测中...' : `检测 ${cadLabel}`}
        </Button>

        {cadDetected && (
          <Button
            onClick={handleLoadAssembly}
            disabled={loadingTree}
          >
            {loadingTree ? '读取中...' : '读取装配结构'}
          </Button>
        )}
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg mt-4 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
