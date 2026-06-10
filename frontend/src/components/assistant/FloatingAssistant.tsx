import { useAssistantStore } from '../../stores/assistant';
import MessageList from './MessageList';
import ChatInput from './ChatInput';

export default function FloatingAssistant() {
  const { open, toggle } = useAssistantStore();
  return (
    <>
      <button onClick={toggle}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 flex items-center justify-center text-xl">
        {open ? '×' : 'AI'}
      </button>
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-96 h-[32rem] bg-white rounded-xl shadow-2xl border flex flex-col">
          <div className="px-4 py-2 border-b font-medium text-sm">PDM 智能助手</div>
          <MessageList />
          <ChatInput />
        </div>
      )}
    </>
  );
}
