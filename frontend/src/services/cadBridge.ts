const DEFAULT_BRIDGE_URL = (() => {
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return `wss://${window.location.host}/ws/bridge`;
  }
  return `ws://${window.location.hostname}:9527`;
})();

interface BridgeRequest {
  id: number;
  method: string;
  params: Record<string, any>;
  token: string;
}

interface BridgeResponse {
  id: number;
  result?: any;
  error?: { code: string; message: string };
}

class CADBridgeClient {
  private ws: WebSocket | null = null;
  private url: string;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private nextId = 1;
  private onStatusChange?: (connected: boolean) => void;

  constructor(url?: string) {
    this.url = url || DEFAULT_BRIDGE_URL;
  }

  setStatusCallback(cb: (connected: boolean) => void) {
    this.onStatusChange = cb;
  }

  connect(token: string): Promise<void> {
    console.log('[CAD Bridge] 正在连接:', this.url);
    return new Promise((resolve, reject) => {
      if (this.ws) {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.close();
        this.ws = null;
      }

      const ws = new WebSocket(this.url);
      this.ws = ws;

      const timeout = setTimeout(() => {
        console.log('[CAD Bridge] 连接超时, readyState:', ws.readyState);
        if (ws.readyState !== WebSocket.OPEN) {
          ws.close();
          this.ws = null;
          reject(new Error('无法连接到 CAD 桥接服务，请确认服务已启动'));
        }
      }, 5000);

      ws.onopen = () => {
        console.log('[CAD Bridge] 连接成功');
        clearTimeout(timeout);
        this.onStatusChange?.(true);
        resolve();
      };

      ws.onclose = (e) => {
        console.log('[CAD Bridge] 连接关闭, code:', e.code, 'reason:', e.reason);
        clearTimeout(timeout);
        this.onStatusChange?.(false);
        this.ws = null;
      };

      ws.onerror = () => {
        // 不在这里 reject，让 timeout 或 onclose 处理
      };

      ws.onmessage = (event) => {
        try {
          const response: BridgeResponse = JSON.parse(event.data);
          const pending = this.pending.get(response.id);
          if (pending) {
            this.pending.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch (e) {
          // 忽略非 JSON 消息
        }
      };
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
  }

  call(method: string, params: Record<string, any> = {}, token: string, timeoutMs = 30000): Promise<any> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error('桥接服务未连接'));
    }

    const id = this.nextId++;
    const request: BridgeRequest = { id, method, params, token };

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify(request));

      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('请求超时'));
        }
      }, timeoutMs);
    });
  }
}

export const cadBridge = new CADBridgeClient();
