import { useEffect, useState } from 'react';
import { authApi } from '../services/api';
import Badge from './ui/Badge';
import { ConfirmModal } from './Modal';

interface FeishuProvider {
  key: string;
  name: string;
  app_id: string;
  jsapi: boolean;
}

interface FeishuBinding {
  provider: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string | null;
}

export default function FeishuBindPanel() {
  const [providers, setProviders] = useState<FeishuProvider[]>([]);
  const [bindings, setBindings] = useState<Record<string, FeishuBinding>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([authApi.feishuConfig(), authApi.feishuBindings()])
      .then(([cfgRes, bindRes]) => {
        setProviders(cfgRes.data.providers ?? []);
        const map: Record<string, FeishuBinding> = {};
        for (const b of bindRes.data.bindings ?? []) map[b.provider] = b;
        setBindings(map);
      })
      .catch(() => setError('加载飞书绑定信息失败'))
      .finally(() => setLoading(false));
  }, []);

  const handleBind = async (provider: FeishuProvider) => {
    try {
      const res = await authApi.feishuBindIntent(provider.key);
      const intent = encodeURIComponent(res.data.intent);
      window.location.href = `/api/auth/feishu/authorize?provider=${provider.key}&intent=${intent}`;
    } catch {
      setError('发起绑定失败，请重试');
    }
  };

  // 解绑确认（状态驱动 ConfirmModal）
  const [unbindProvider, setUnbindProvider] = useState<FeishuProvider | null>(null);
  const doUnbind = async (provider: FeishuProvider) => {
    try {
      await authApi.feishuUnbind(provider.key);
      setBindings((prev) => {
        const next = { ...prev };
        delete next[provider.key];
        return next;
      });
    } catch {
      setError('解除绑定失败，请重试');
    }
  };
  const handleUnbind = (provider: FeishuProvider) => setUnbindProvider(provider);

  return (
    <div className="max-w-md">
      <div className="bg-[var(--ui-bg-surface)] rounded-lg border border-[var(--ui-border)] p-6 space-y-4">
        <h3 className="text-lg font-medium">飞书绑定</h3>
        <p className="text-sm text-[var(--ui-text-secondary)]">
          绑定后，飞书免登将直接进入当前账号；每个飞书入口只能绑定一个账号。
        </p>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}
        {loading ? (
          <p className="text-sm text-[var(--ui-text-tertiary)]">加载中...</p>
        ) : providers.length === 0 ? (
          <p className="text-sm text-[var(--ui-text-tertiary)]">未配置飞书应用</p>
        ) : (
          providers.map((p) => {
            const b = bindings[p.key];
            return (
              <div
                key={p.key}
                className="flex items-center justify-between border border-[var(--ui-border)] rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  {b?.avatar_url && (
                    <img src={b.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    {b ? (
                      <p className="text-xs text-[var(--ui-text-secondary)]">{b.name || '已绑定'}</p>
                    ) : (
                      <p className="text-xs text-[var(--ui-text-tertiary)]">未绑定</p>
                    )}
                  </div>
                </div>
                {b ? (
                  <div className="flex items-center gap-2">
                    <Badge tone="green" label="已绑定" />
                    <button
                      onClick={() => handleUnbind(p)}
                      className="text-xs text-red-500 hover:text-red-700 hover:underline"
                    >
                      解除
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleBind(p)}
                    className="px-3 py-1 text-sm border border-blue-600 text-blue-600 rounded-lg hover:bg-blue-50"
                  >
                    绑定
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 解绑确认 */}
      <ConfirmModal
        open={!!unbindProvider}
        title="确认解绑"
        content={unbindProvider ? `确定要解除「${unbindProvider.name}」的绑定吗？` : ''}
        confirmText="解除"
        cancelText="取消"
        type="danger"
        onConfirm={() => { if (unbindProvider) doUnbind(unbindProvider); setUnbindProvider(null); }}
        onCancel={() => setUnbindProvider(null)}
      />
    </div>
  );
}
