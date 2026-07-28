import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useLicenseStore } from '../stores/license';
import { showToast } from './Toast';

export default function LicenseBanner() {
  const status = useLicenseStore((s) => s.status);

  useEffect(() => {
    const handler = (e: Event) => {
      const msg = (e as CustomEvent).detail as string;
      showToast(msg, 'error');
    };
    window.addEventListener('license-error', handler);
    return () => window.removeEventListener('license-error', handler);
  }, []);

  if (!status || status.state === 'VALID') return null;

  const isGrace = status.state === 'GRACE';
  const text = isGrace
    ? status.reason || '许可证已过期，请尽快联系供应商续期'
    : status.state === 'MISSING'
      ? '未安装许可证，系统处于只读模式'
      : '许可证已过期或无效，系统处于只读模式，请联系供应商续期';

  return (
    <div
      className={`px-4 py-2 text-sm flex items-center justify-between ${
        isGrace
          ? 'bg-yellow-50 text-yellow-800 border-b border-yellow-200'
          : 'bg-red-50 text-red-800 border-b border-red-200'
      }`}
    >
      <span>{text}</span>
      <Link to="/settings" className="underline shrink-0 ml-4">
        前往许可管理
      </Link>
    </div>
  );
}
