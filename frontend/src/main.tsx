import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { applyTheme, getStoredTheme } from './lib/theme';

// 设置浏览器标签页标题（可通过 frontend/.env 中 VITE_APP_TITLE 自定义）
document.title = import.meta.env.VITE_APP_TITLE || 'PDM系统';

// 应用持久化主题（index.html 内联脚本已先行处理防闪烁；此处兜底）
applyTheme(getStoredTheme());

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);