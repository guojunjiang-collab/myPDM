import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CADBridgeClient } from './cadBridge';

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];
  static OPEN = 1;
  readyState = 0;
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  sent: string[] = [];

  constructor(_url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {}
}

describe('CADBridgeClient 进度路由', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    FakeWebSocket.instances = [];
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWebSocket;
  });

  afterEach(() => {
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = originalWebSocket;
  });

  it('按 request_id 将进度事件路由到 onProgress，响应仍正常 resolve', async () => {
    const client = new CADBridgeClient('ws://test');
    const connectPromise = client.connect('token');
    const ws = FakeWebSocket.instances[0];
    ws.readyState = 1;
    ws.onopen?.(null);
    await connectPromise;

    const progress: unknown[] = [];
    const resultPromise = client.call(
      'catia.assembly.read_tree',
      {},
      'token',
      10000,
      (e) => progress.push(e),
    );

    ws.onmessage?.({ data: JSON.stringify({ event: 'progress', request_id: 1, current: 3, name: 'Part3' }) });
    expect(progress).toEqual([{ event: 'progress', request_id: 1, current: 3, name: 'Part3' }]);

    ws.onmessage?.({ data: JSON.stringify({ id: 1, result: { ok: true } }) });
    await expect(resultPromise).resolves.toEqual({ ok: true });
  });

  it('非进度事件（无 event 字段）不触发 onProgress', async () => {
    const client = new CADBridgeClient('ws://test');
    const connectPromise = client.connect('token');
    const ws = FakeWebSocket.instances[0];
    ws.readyState = 1;
    ws.onopen?.(null);
    await connectPromise;

    const progress: unknown[] = [];
    const resultPromise = client.call('catia.ping', {}, 'token', 10000, (e) => progress.push(e));

    ws.onmessage?.({ data: JSON.stringify({ id: 1, result: { status: 'ok' } }) });
    await expect(resultPromise).resolves.toEqual({ status: 'ok' });
    expect(progress).toEqual([]);
  });
});
