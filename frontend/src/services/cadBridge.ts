const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:9527';

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
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private onStatusChange?: (connected: boolean) => void;

  constructor(url?: string) {
    this.url = url || DEFAULT_BRIDGE_URL;
  }

  setStatusCallback(cb: (connected: boolean) => void) {
    this.onStatusChange = cb;
  }

  connect(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this.onStatusChange?.(true);
        resolve();
      };

      this.ws.onclose = () => {
        this.onStatusChange?.(false);
        this.ws = null;
        // 自动重连
        this.reconnectTimer = setTimeout(() => this.connect(token), 3000);
      };

      this.ws.onerror = () => {
        reject(new Error('无法连接到 CAD 桥接服务'));
      };

      this.ws.onmessage = (event) => {
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
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  call(method: string, params: Record<string, any> = {}, token: string): Promise<any> {
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
      }, 30000);
    });
  }
}

export const cadBridge = new CADBridgeClient();
