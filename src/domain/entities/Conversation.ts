import { ObjectId } from 'mongodb';

export type ConversationType = 'chat' | 'gamecreation';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

export interface ConversationTokens {
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface Conversation {
  _id: ObjectId;
  telegramId: number;
  type: ConversationType;
  messages: Message[];
  tokens: ConversationTokens;
  isActive: boolean;
  lastMessageAt: Date;
  createdAt: Date;
}

export function createNewConversation(telegramId: number, type: ConversationType = 'chat'): Omit<Conversation, '_id'> {
  const now = new Date();
  return {
    telegramId,
    type,
    messages: [],
    tokens: {
      totalInputTokens: 0,
      totalOutputTokens: 0,
    },
    isActive: true,
    lastMessageAt: now,
    createdAt: now,
  };
}

export function addMessage(conversation: Conversation, role: Message['role'], content: string): Conversation {
  const now = new Date();
  return {
    ...conversation,
    messages: [
      ...conversation.messages,
      { role, content, createdAt: now },
    ],
    lastMessageAt: now,
  };
}

export function deactivateConversation(conversation: Conversation): Conversation {
  return {
    ...conversation,
    isActive: false,
  };
}

export function isConversationExpired(conversation: Conversation, timeoutHours: number): boolean {
  const now = new Date();
  const lastMessage = conversation.lastMessageAt;
  const diffMs = now.getTime() - lastMessage.getTime();
  const diffHours = diffMs / (1000 * 60 * 60);
  return diffHours > timeoutHours;
}

export function updateTokens(
  conversation: Conversation,
  inputTokens: number,
  outputTokens: number
): Conversation {
  return {
    ...conversation,
    tokens: {
      totalInputTokens: (conversation.tokens?.totalInputTokens ?? 0) + inputTokens,
      totalOutputTokens: (conversation.tokens?.totalOutputTokens ?? 0) + outputTokens,
    },
  };
}

// Estimate tokens for a message (roughly 4 characters per token)
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
