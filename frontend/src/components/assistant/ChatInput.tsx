import { useState } from 'react';
import { useAssistantChat } from '../../hooks/useAssistantChat';
import { useAssistantStore } from '../../stores/assistant';

export default function ChatInput() {
  const [text, setText] = useState('');
  const { send } = useAssistantChat();
  const busy = useAssistantStore((s) => s.busy);
  const submit = () => { const t = text; setText(''); send(t); };
  return (
    <div className="border-t p-2 flex gap-2">
      <input value={text} onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
        disabled={busy} placeholder="问点什么，比如：对比 A-1 和 A-2 的 BOM"
        className="flex-1 border rounded-md px-3 py-1.5 text-sm" />
      <button onClick={submit} disabled={busy}
        className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-sm disabled:opacity-50">
        发送
      </button>
    </div>
  );
}
