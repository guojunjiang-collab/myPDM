const H5_SDK_URL = 'https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.45.js';

declare global {
  interface Window {
    h5sdk?: any;
    tt?: any;
  }
}

export function isFeishuClient(): boolean {
  return /Feishu|Lark/i.test(navigator.userAgent);
}

export function getFeishuProviderParam(): string | null {
  return new URLSearchParams(window.location.search).get('feishu_provider');
}

export function loadH5Sdk(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.h5sdk) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = H5_SDK_URL;
    script.onload = () => {
      const start = Date.now();
      const timer = window.setInterval(() => {
        if (window.h5sdk) {
          window.clearInterval(timer);
          resolve();
        } else if (Date.now() - start > 5000) {
          window.clearInterval(timer);
          reject(new Error('飞书 JSSDK 就绪超时'));
        }
      }, 100);
    };
    script.onerror = () => reject(new Error('加载飞书 JSSDK 失败'));
    document.head.appendChild(script);
  });
}

export function requestAccessCode(appId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const tt = window.tt;
    if (!tt?.requestAccess) {
      reject(new Error('当前环境不支持飞书免登'));
      return;
    }
    const ERRNO_MESSAGES: Record<number, string> = {
      103: '飞书客户端版本过低，不支持免登',
      20029: '飞书后台重定向 URL / H5 可信域名未配置或与当前地址不一致',
      2700001: '飞书获取 session 失败，请重试或检查应用配置',
      2700002: '飞书授权被终止，请重新授权',
    };
    tt.requestAccess({
      appID: appId,
      scopeList: [],
      success: (res: any) => {
        const raw = res && res.data && typeof res.data === 'object' ? res.data : res;
        const code = raw?.authCode ?? raw?.auth_code ?? raw?.code ?? (typeof raw === 'string' ? raw : null);
        if (code) resolve(String(code));
        else reject(new Error('飞书未返回授权码'));
      },
      fail: (err: any) => {
        const errno = err?.errno ?? err?.code;
        const hint = errno != null ? ERRNO_MESSAGES[Number(errno)] : '';
        const detail = err?.errMsg ? `（${err.errMsg}）` : '';
        console.error('[feishu] requestAccess fail:', err);
        let msg = hint || (errno != null ? `飞书免登失败(errno=${errno})` : err?.errMsg || '飞书免登失败');
        if (detail) msg += detail;
        reject(new Error(msg));
      },
    });
  });
}
