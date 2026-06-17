import { useAuthStore } from '../stores/auth';
import { toast } from '../components/Toast';
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

function filenameFromDisposition(cd: string): string {
  // 优先 RFC 5987 的 filename*=UTF-8''xxx，其次普通 filename="xxx"
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) {
    try { return decodeURIComponent(star[1]); } catch { /* fallthrough */ }
  }
  const plain = cd.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : '';
}

/**
 * 鉴权下载。两类下载端点鉴权方式不同，故同时附带：
 * - 附件端点（/api/v2/attachments/.../direct-download）应使用 mediaApi.token() 获取短期令牌
 * - BOM 导出 / 助手产物端点用 Authorization 头鉴权（require_role）
 * 并校验 response.ok，避免把 401/404 的错误 JSON 当成文件下载下来。
 *
 * 注意：调用方若传入附件端点 URL，应改用 mediaApi.token() 获取短期令牌后直接拼接。
 */
export async function authedDownload(url: string): Promise<void> {
  const token = useAuthStore.getState().token;
  let finalUrl = url;
  if (token) {
    const sep = url.includes('?') ? '&' : '?';
    finalUrl = `${url}${sep}token=${encodeURIComponent(token)}`;
  }
  try {
    const resp = await fetch(finalUrl, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!resp.ok) {
      let detail = '';
      try { detail = (await resp.json())?.detail || ''; } catch { /* 非 JSON */ }
      toast.error(`下载失败（${resp.status}）${detail ? '：' + detail : ''}`);
      return;
    }
    const blob = await resp.blob();
    const filename = filenameFromDisposition(resp.headers.get('Content-Disposition') || '');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    toast.error(`下载失败：${e instanceof Error ? e.message : String(e)}`);
  }
}
