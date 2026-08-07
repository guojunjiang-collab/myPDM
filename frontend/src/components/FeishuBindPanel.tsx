import { useEffect, useState } from 'react';
import { authApi } from '../services/api';

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

  return (
    <div className="max-w-md">
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-4">
        <h3 className="text-lg font-medium">飞书绑定</h3>
        <p className="text-sm text-gray-500">
          绑定后，飞书免登将直接进入当前账号；每个飞书入口只能绑定一个账号。
        </p>
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-2 rounded-lg text-sm">
            {error}
          </div>
        )}
        {loading ? (
          <p className="text-sm text-gray-400">加载中...</p>
        ) : providers.length === 0 ? (
          <p className="text-sm text-gray-400">未配置飞书应用</p>
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
                  <span className="text-xs px-2 py-1 bg-green-50 text-green-700 rounded-full">已绑定</span>
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
