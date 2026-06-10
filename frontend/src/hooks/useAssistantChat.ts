import { useCallback } from 'react';
import { useAssistantStore } from '../stores/assistant';
import { streamChat } from '../services/assistantApi';

export function useAssistantChat() {
  const store = useAssistantStore();

  const send = useCallback(async (text: string) => {
    if (!text.trim() || store.busy) return;
    store.pushUser(text);
    const history = useAssistantStore.getState().messages;
    store.startAssistant();
    try {
      await streamChat(history, (ev) => {
        switch (ev.type) {
          case 'token': store.appendToken(ev.delta); break;
          case 'card': store.addCard({ card_type: ev.card_type, payload: ev.payload }); break;
          case 'done': store.finish(); break;
          case 'error': store.setError(ev.message); break;
          default: break; // tool_start/tool_end 可后续做状态条
        }
      });
      useAssistantStore.getState().finish();
    } catch (e) {
      useAssistantStore.getState().setError(String(e));
    }
  }, [store]);

  return { send };
}
