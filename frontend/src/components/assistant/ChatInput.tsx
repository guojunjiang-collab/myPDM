import { useState, useRef, useLayoutEffect } from 'react';
import { useAssistantChat } from '../../hooks/useAssistantChat';
import { useAssistantStore } from '../../stores/assistant';

const MAX_HEIGHT = 120; // 约 5 行后内部滚动

export default function ChatInput() {
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const { send } = useAssistantChat();
  const busy = useAssistantStore((s) => s.busy);

  // 自适应高度：内容增减时按 scrollHeight 调整，封顶后滚动
  useLayoutEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, MAX_HEIGHT)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t) return;
    setText('');
    send(t);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return;
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+Enter：在光标处插入换行
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = text.slice(0, start) + '\n' + text.slice(end);
      setText(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 1;
      });
    } else {
      // Enter：发送
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="border-t p-2 flex items-end gap-2">
      <textarea ref={taRef} value={text} rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        disabled={busy}
        placeholder="问点什么…（Enter 发送，Ctrl+Enter 换行）"
        className="flex-1 resize-none overflow-y-auto border rounded-md px-3 py-1.5 text-sm leading-relaxed" />
      <button onClick={submit} disabled={busy}
        className="shrink-0 px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm disabled:opacity-50">
        发送
      </button>
    </div>
  );
}
