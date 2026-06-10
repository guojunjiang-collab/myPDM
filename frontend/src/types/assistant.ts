export type CardType = 'table' | 'markdown_doc' | 'download' | 'link';

export interface AssistantCard {
  card_type: CardType;
  payload: Record<string, unknown>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  text: string;
  cards: AssistantCard[];
  streaming?: boolean;
}

export type SSEEvent =
  | { type: 'token'; delta: string }
  | { type: 'tool_start'; name: string; summary: string }
  | { type: 'tool_end'; name: string; ok: boolean }
  | { type: 'card'; card_type: CardType; payload: Record<string, unknown> }
  | { type: 'done' }
  | { type: 'error'; message: string };
