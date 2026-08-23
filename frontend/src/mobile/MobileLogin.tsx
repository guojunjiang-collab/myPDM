import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { authApi } from '../services/api';
import Button from '../components/ui/Button';
import { getFeishuProviderParam, isFeishuClient } from '../lib/feishu';

interface OAuthProvider {
  key: string;
  name: string;
  app_id: string;
  jsapi?: boolean;
}

export default function MobileLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [feishuProviders, setFeishuProviders] = useState<OAuthProvider[]>([]);
  const [wechatProviders, setWechatProviders] = useState<OAuthProvider[]>([]);

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

    authApi
      .feishuConfig()
      .then((res) => {
        const providers: OAuthProvider[] = res.data.providers ?? [];
        setFeishuProviders(providers);
        // 刚从 OAuth 回调带错回来时不再自动触发免登，避免跳转循环
        if (!urlError && isFeishuClient() && providers.length > 0) {
          const want = getFeishuProviderParam();
          const provider =
            providers.find((p) => (want ? p.key === want : p.key === 'feishu')) ?? providers[0];
          // 客户端内直接走 OAuth 免登：requestAccess 在当前客户端环境会失败并触发"授权失败"弹框，
          // OAuth 在客户端内同样免确认跳转，体验一致且稳定。
          window.location.href = `/api/auth/feishu/authorize?provider=${provider.key}`;
        }
      })
      .catch(() => {});

    authApi
      .wechatConfig()
      .then((res) => setWechatProviders(res.data.providers ?? []))
      .catch(() => {});
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await authApi.login(username, password);
      const { access_token, refresh_token } = response.data;
      await finishLogin(access_token, refresh_token);
    } catch {
      setError('用户名或密码错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 bg-gray-50">
      <h1 className="text-2xl font-bold mb-1">🏗️ {import.meta.env.VITE_APP_TITLE || 'PDM系统'}</h1>
      <p className="text-sm text-gray-500 mb-8">移动端 · 只读查询</p>
      <form onSubmit={handleSubmit} className="w-full max-w-sm flex flex-col gap-3">
        <input
          className="h-12 px-4 rounded-lg bg-white border border-gray-200 text-base focus:outline-none focus:ring-2 focus:ring-primary-500"
          placeholder="用户名"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          required
        />
        <input
          className="h-12 px-4 rounded-lg bg-white border border-gray-200 text-base focus:outline-none focus:ring-2 focus:ring-primary-500"
          type="password"
          placeholder="密码"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button
          type="submit"
          disabled={loading}
          size="touch"
          className="w-full"
        >
          {loading ? '登录中...' : '登录'}
        </Button>
      </form>
      {(feishuProviders.length > 0 || wechatProviders.length > 0) && (
        <div className="w-full max-w-sm mt-6 flex flex-col gap-2">
          {feishuProviders.map((p) => (
            <Button
              key={`feishu-${p.key}`}
              variant="secondary"
              size="touch"
              className="w-full"
              onClick={() => {
                window.location.href = `/api/auth/feishu/authorize?provider=${p.key}`;
              }}
            >
              {p.name}
            </Button>
          ))}
          {wechatProviders.map((p) => (
            <Button
              key={`wechat-${p.key}`}
              variant="secondary"
              size="touch"
              className="w-full"
              onClick={() => {
                window.location.href = `/api/auth/wechat/authorize?provider=${p.key}`;
              }}
            >
              {p.name}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
