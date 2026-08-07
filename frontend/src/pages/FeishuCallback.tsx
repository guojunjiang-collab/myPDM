import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { authApi } from '../services/api';

export default function FeishuCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const error = params.get('error');

    if (error) {
      navigate(`/login?error=${encodeURIComponent(error)}`, { replace: true });
      return;
    }
    if (!accessToken) {
      navigate('/login?error=' + encodeURIComponent('飞书登录失败：缺少令牌'), { replace: true });
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
        navigate('/login?error=' + encodeURIComponent('飞书登录失败：无法获取用户信息'), { replace: true });
      });
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="text-gray-500">正在登录...</div>
    </div>
  );
}
