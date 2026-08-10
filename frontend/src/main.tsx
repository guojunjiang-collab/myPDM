import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// 设置浏览器标签页标题（可通过 frontend/.env 中 VITE_APP_TITLE 自定义）
document.title = import.meta.env.VITE_APP_TITLE || 'PDM系统';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);