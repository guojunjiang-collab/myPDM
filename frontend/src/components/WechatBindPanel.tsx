import { useEffect, useState } from 'react';
import { authApi } from '../services/api';
import Badge from './ui/Badge';

interface WechatProvider {
  key: string;
  name: string;
  app_id: string;
}

interface WechatBinding {
  provider: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string | null;
}

export default function WechatBindPanel() {
  const [providers, setProviders] = useState<WechatProvider[]>([]);
  const [bindings, setBindings] = useState<Record<string, WechatBinding>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([authApi.wechatConfig(), authApi.wechatBindings()])
      .then(([cfgRes, bindRes]) => {
        setProviders(cfgRes.data.providers ?? []);
        const map: Record<string, WechatBinding> = {};
        for (const b of bindRes.data.bindings ?? []) map[b.provider] = b;
        setBindings(map);
      })
      .catch(() => setError('加载微信绑定信息失败'))
      .finally(() => setLoading(false));
  }, []);

  const handleBind = async (provider: WechatProvider) => {
    try {
      const res = await authApi.wechatBindIntent(provider.key);
      const intent = encodeURIComponent(res.data.intent);
      window.location.href = `/api/auth/wechat/authorize?provider=${provider.key}&intent=${intent}`;
    } catch {
      setError('发起绑定失败，请重试');
    }
  };

  const handleUnbind = async (provider: WechatProvider) => {
    if (!confirm(`确定要解除「${provider.name}」的绑定吗？`)) return;
    try {
      await authApi.wechatUnbind(provider.key);
      setBindings((prev) => {
        const next = { ...prev };
        delete next[provider.key];
        return next;
      });
    } catch {
      setError('解除绑定失败，请重试');
    }
  };

  return (
    <div className="max-w-md">
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h3 className="text-lg font-medium">微信绑定</h3>
        <p className="text-sm text-gray-500">
          绑定后，微信扫码登录将直接进入当前账号；每个微信入口只能绑定一个账号。
        </p>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}
        {loading ? (
          <p className="text-sm text-gray-400">加载中...</p>
        ) : providers.length === 0 ? (
          <p className="text-sm text-gray-400">未配置微信应用</p>
        ) : (
          providers.map((p) => {
            const b = bindings[p.key];
            return (
              <div
                key={p.key}
                className="flex items-center justify-between border border-gray-200 rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  {b?.avatar_url && (
                    <img src={b.avatar_url} alt="" className="w-8 h-8 rounded-full" />
                  )}
                  <div>
                    <p className="text-sm font-medium">{p.name}</p>
                    {b ? (
                      <p className="text-xs text-gray-500">{b.name || '已绑定'}</p>
                    ) : (
                      <p className="text-xs text-gray-400">未绑定</p>
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
    </div>
  );
}
