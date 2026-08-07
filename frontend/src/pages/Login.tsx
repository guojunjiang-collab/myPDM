import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { authApi } from '../services/api';
import { getFeishuProviderParam, isFeishuClient, loadH5Sdk, requestAccessCode } from '../lib/feishu';

interface FeishuProvider {
  key: string;
  name: string;
  app_id: string;
  jsapi: boolean;
}

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [feishuProviders, setFeishuProviders] = useState<FeishuProvider[]>([]);

  const finishLogin = async (accessToken: string, refreshToken?: string | null) => {
    useAuthStore.getState().setUser(null, accessToken);
    if (refreshToken) localStorage.setItem('refresh_token', refreshToken);
    const userResponse = await authApi.getCurrentUser();
    useAuthStore.getState().setUser(userResponse.data, accessToken);
    navigate(userResponse.data.must_change_password ? '/change-password' : '/');
  };

  useEffect(() => {
    const urlError = new URLSearchParams(window.location.search).get('error');
    if (urlError) setError(urlError);

    let cancelled = false;
    authApi
      .feishuConfig()
      .then((res) => {
        const providers: FeishuProvider[] = res.data.providers ?? [];
        setFeishuProviders(providers);
        if (isFeishuClient() && providers.length > 0) {
          const want = getFeishuProviderParam();
          const provider =
            providers.find((p) => (want ? p.key === want : p.key === 'feishu')) ?? providers[0];
          if (provider?.jsapi) {
            loadH5Sdk()
              .then(() => requestAccessCode(provider.app_id))
              .then((code) => authApi.feishuJsapiLogin(provider.key, code))
              .then(async (loginRes) => {
                const { access_token, refresh_token } = loginRes.data;
                if (cancelled) return;
                await finishLogin(access_token, refresh_token);
              })
              .catch((e: Error) => {
                if (!cancelled) setError(e?.message || '飞书免登失败');
              });
          }
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await authApi.login(username, password);
      const { access_token, refresh_token } = response.data;
      await finishLogin(access_token, refresh_token);
    } catch (err) {
      setError('用户名或密码错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-semibold">🏗️ PDM系统</h1>
          <p className="text-gray-500 mt-2">物料清单全生命周期数字化管理平台</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">用户名</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="请输入用户名"
              required
            />
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-1">密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500"
              placeholder="请输入密码"
              required
            />
          </div>

          {error && <p className="mb-4 text-sm text-red-600 text-center">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 px-4 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '登录中...' : '登 录'}
          </button>
        </form>

        {feishuProviders.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center gap-3 text-gray-400 text-sm">
              <span className="flex-1 border-t border-gray-200" />
              或
              <span className="flex-1 border-t border-gray-200" />
            </div>
            <div className="mt-4 space-y-2">
              {feishuProviders.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => {
                    window.location.href = `/api/auth/feishu/authorize?provider=${p.key}`;
                  }}
                  className="w-full py-2 px-4 border border-gray-300 rounded-lg hover:bg-gray-50 text-gray-700"
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
