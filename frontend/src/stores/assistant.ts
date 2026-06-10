import { create } from 'zustand';
import type { ChatMessage, AssistantCard } from '../types/assistant';

interface AssistantState {
  open: boolean;
  messages: ChatMessage[];
  busy: boolean;
  toggle: () => void;
  pushUser: (text: string) => void;
  startAssistant: () => void;
  appendToken: (delta: string) => void;
  addCard: (card: AssistantCard) => void;
  finish: () => void;
  setError: (msg: string) => void;
}

export const useAssistantStore = create<AssistantState>((set) => ({
  open: false,
  messages: [],
  busy: false,
  toggle: () => set((s) => ({ open: !s.open })),
  pushUser: (text) =>
    set((s) => ({ messages: [...s.messages, { role: 'user', text, cards: [] }] })),
  startAssistant: () =>
    set((s) => ({ busy: true,
      messages: [...s.messages, { role: 'assistant', text: '', cards: [], streaming: true }] })),
  appendToken: (delta) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') last.text += delta;
      return { messages: msgs };
    }),
  addCard: (card) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') last.cards = [...last.cards, card];
      return { messages: msgs };
    }),
  finish: () =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last) last.streaming = false;
      return { busy: false, messages: msgs };
    }),
  setError: (msg) =>
    set((s) => {
      const msgs = [...s.messages];
      const last = msgs[msgs.length - 1];
      if (last && last.role === 'assistant') last.text += `\n\n⚠️ ${msg}`;
      return { busy: false, messages: msgs };
    }),
}));
