import { useEffect, useRef, useState } from 'react';
import { useLicenseStore } from '../../stores/license';
import { licenseApi } from '../../services/licenseApi';
import type { LicenseState } from '../../types';

const STATE_LABEL: Record<LicenseState, string> = {
  VALID: '正常',
  GRACE: '已过期（宽限期内）',
  READONLY: '已过期（只读模式）',
  TAMPERED: '无效（签名或硬件不匹配）',
  MISSING: '未安装许可证',
};

const STATE_CLASS: Record<LicenseState, string> = {
  VALID: 'bg-green-100 text-green-700',
  GRACE: 'bg-yellow-100 text-yellow-700',
  READONLY: 'bg-red-100 text-red-700',
  TAMPERED: 'bg-red-100 text-red-700',
  MISSING: 'bg-gray-100 text-gray-600',
};

const MODULE_LABEL: Record<string, string> = {
  change: '变更管理',
  inventory: '库存管理',
  project: '项目管理',
};

export default function LicenseTab() {
  const { status, fetch, setStatus } = useLicenseStore();
  const [machineCode, setMachineCode] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch();
    licenseApi.getMachineCode().then(setMachineCode).catch(() => setMachineCode('--'));
  }, [fetch]);

  const copyMachineCode = async () => {
    await navigator.clipboard.writeText(machineCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleFile = async (file: File) => {
    setError('');
    setUploading(true);
    try {
      setStatus(await licenseApi.upload(file));
    } catch (e: any) {
      setError(e?.response?.data?.detail || '许可证上传失败');
    } finally {
      setUploading(false);
    }
  };

  const row = (label: string, value: React.ReactNode) => (
    <div className="flex py-2 border-b border-gray-100">
      <div className="w-32 text-sm text-gray-500">{label}</div>
      <div className="flex-1 text-sm text-gray-900">{value}</div>
    </div>
  );

  return (
    <div className="max-w-2xl">
      {status && (
        <div className="mb-6">
          <div className="mb-3">
            <span className={`px-2 py-1 rounded text-sm ${STATE_CLASS[status.state]}`}>
              {STATE_LABEL[status.state]}
            </span>
            {status.reason && (
              <span className="ml-2 text-sm text-gray-500">{status.reason}</span>
            )}
          </div>
          {row('客户名称', status.customer || '--')}
          {row('授权版本', status.edition === 'full' ? '全量版' : status.edition === 'basic' ? '基础版' : '--')}
          {row('许可编号', status.license_id || '--')}
          {row('到期日期', status.expires_at || '--')}
          {row('剩余天数', status.days_left === null ? '--' : `${status.days_left} 天`)}
          {row('用户数', `${status.used_users} / ${status.max_users ?? '--'}`)}
          {row('可选模块', status.modules.length
            ? status.modules.map((m) => MODULE_LABEL[m] || m).join('、')
            : '无（基础版）')}
        </div>
      )}

      <div className="mb-6">
        <div className="text-sm text-gray-500 mb-2">本机机器码（申请许可证时提供给供应商）</div>
        <div className="flex items-center gap-2">
          <code className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm">
            {machineCode || '--'}
          </code>
          <button
            onClick={copyMachineCode}
            className="px-3 py-2 text-sm bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      </div>

      <div>
        <div className="text-sm text-gray-500 mb-2">上传许可证文件</div>
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files?.[0];
            if (file) handleFile(file);
          }}
          onClick={() => fileRef.current?.click()}
          className="border-2 border-dashed border-gray-300 rounded p-8 text-center cursor-pointer hover:border-blue-400"
        >
          <p className="text-sm text-gray-500">
            {uploading ? '上传中…' : '点击选择或拖拽 .lic 文件到此处'}
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept=".lic"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </div>
    </div>
  );
}
