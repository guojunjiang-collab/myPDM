import { useAssistantStore } from '../../stores/assistant';
import TextCard from './cards/TextCard';
import TableCard from './cards/TableCard';
import MarkdownCard from './cards/MarkdownCard';
import DownloadCard from './cards/DownloadCard';
import LinkCard from './cards/LinkCard';
import type { AssistantCard } from '../../types/assistant';

function renderCard(card: AssistantCard, i: number) {
  const p = card.payload as never;
  switch (card.card_type) {
    case 'table': return <TableCard key={i} payload={p} />;
    case 'markdown_doc': return <MarkdownCard key={i} payload={p} />;
    case 'download': return <DownloadCard key={i} payload={p} />;
    case 'link': return <LinkCard key={i} payload={p} />;
    default: return null;
  }
}

export default function MessageList() {
  const messages = useAssistantStore((s) => s.messages);
  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-3">
      {messages.map((m, i) => (
        <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
          <div className={`inline-block max-w-[90%] rounded-lg px-3 py-2 ${
            m.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-900'}`}>
            {m.role === 'assistant'
              ? <><TextCard text={m.text} streaming={m.streaming} />
                  {m.cards.map(renderCard)}</>
              : <span className="block text-left text-sm whitespace-pre-wrap break-words">{m.text}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}
