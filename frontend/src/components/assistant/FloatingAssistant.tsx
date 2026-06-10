import { useAssistantStore } from '../../stores/assistant';
import { useResizable } from '../../hooks/useResizable';
import MessageList from './MessageList';
import ChatInput from './ChatInput';

export default function FloatingAssistant() {
  const { open, toggle, size } = useAssistantStore();
  const { onPointerDown } = useResizable();
  return (
    <>
      <button onClick={toggle}
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-blue-600 text-white shadow-lg hover:bg-blue-700 flex items-center justify-center text-xl">
        {open ? '×' : 'AI'}
      </button>
      {open && (
        <div style={{ width: size.width, height: size.height }}
          className="fixed bottom-24 right-6 z-50 bg-white rounded-xl shadow-2xl border flex flex-col">
          {/* 左上角拖拽缩放手柄 */}
          <div onPointerDown={onPointerDown}
            title="拖拽调整大小"
            className="absolute -top-1 -left-1 w-5 h-5 cursor-nwse-resize text-gray-400 hover:text-gray-600
              flex items-center justify-center select-none touch-none">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
              <path d="M0 2 L2 0 M0 6 L6 0 M0 10 L10 0" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </div>
          <div className="px-4 py-2 border-b font-medium text-sm">PDM 智能助手</div>
          <MessageList />
          <ChatInput />
        </div>
      )}
    </>
  );
}
