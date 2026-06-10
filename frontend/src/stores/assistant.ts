import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ChatMessage, AssistantCard } from '../types/assistant';

export const ASSISTANT_MIN_SIZE = { width: 320, height: 360 };
const DEFAULT_SIZE = { width: 384, height: 512 }; // 沿用原 w-96 h-[32rem]

interface AssistantState {
  open: boolean;
  messages: ChatMessage[];
  busy: boolean;
  size: { width: number; height: number };
  toggle: () => void;
  setSize: (size: { width: number; height: number }) => void;
  pushUser: (text: string) => void;
  startAssistant: () => void;
  appendToken: (delta: string) => void;
  addCard: (card: AssistantCard) => void;
  finish: () => void;
  setError: (msg: string) => void;
}

export const useAssistantStore = create<AssistantState>()(persist((set) => ({
  open: false,
  messages: [],
  busy: false,
  size: DEFAULT_SIZE,
  toggle: () => set((s) => ({ open: !s.open })),
  setSize: (size) => set({ size }),
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
}), { name: 'assistant-size', partialize: (s) => ({ size: s.size }) }));
