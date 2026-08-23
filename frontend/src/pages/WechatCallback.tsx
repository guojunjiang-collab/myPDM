import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { authApi } from '../services/api';
import { parseWechatCallbackHash } from '../lib/wechat';
import Button from '../components/ui/Button';

export default function WechatCallback() {
  const navigate = useNavigate();
  const [bindingInfo] = useState(() => parseWechatCallbackHash(window.location.hash));

  useEffect(() => {
    if (bindingInfo.mode === 'binding') return;

    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const error = params.get('error');

    if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }
    if (!accessToken) {
      navigate('/login?error=' + encodeURIComponent('微信登录失败：缺少令牌'), { replace: true });
      return;
    }

    useAuthStore.getState().setUser(null, accessToken);
    if (refreshToken) localStorage.setItem('refresh_token', refreshToken);

    authApi
      .getCurrentUser()
      .then((res) => {
        useAuthStore.getState().setUser(res.data, accessToken);
        navigate('/', { replace: true });
      })
      .catch(() => {
        navigate('/login?error=' + encodeURIComponent('微信登录失败：无法获取用户信息'), { replace: true });
      });
  }, [navigate, bindingInfo]);

  if (bindingInfo.mode === 'binding') {
    const ok = bindingInfo.result === 'success';
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md text-center">
          <h1 className="text-xl font-semibold mb-4">{ok ? '绑定成功' : '绑定失败'}</h1>
          {!ok && <p className="text-sm text-red-600 mb-4">{bindingInfo.message || '未知错误'}</p>}
          {ok && <p className="text-sm text-gray-500 mb-4">该微信入口已绑定到当前账号</p>}
          <Button variant="primary" onClick={() => navigate('/settings')}>
            返回系统设置
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-500">正在登录...</div>
    </div>
  );
}
