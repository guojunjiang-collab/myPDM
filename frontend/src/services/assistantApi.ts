import { useAuthStore } from '../stores/auth';
import type { SSEEvent, ChatMessage } from '../types/assistant';

export async function streamChat(
  history: ChatMessage[],
  onEvent: (ev: SSEEvent) => void,
): Promise<void> {
  const token = useAuthStore.getState().token;
  const messages = history.map((m) => ({ role: m.role, content: m.text }));
  const resp = await fetch('/api/assistant/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages }),
  });
  if (!resp.body) throw new Error('无响应流');
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() || '';
    for (const p of parts) {
      const line = p.trim();
      if (!line.startsWith('data:')) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()) as SSEEvent);
      } catch {
        /* 忽略半包 */
      }
    }
  }
}

// 给下载链接附带 token（后端下载端点需鉴权）
export function authedDownload(url: string): void {
  const token = useAuthStore.getState().token;
  fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    .then((r) => r.blob())
    .then((blob) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '';
      a.click();
      URL.revokeObjectURL(a.href);
    });
}
