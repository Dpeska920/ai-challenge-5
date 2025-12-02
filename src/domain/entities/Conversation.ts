import { ObjectId } from 'mongodb';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  createdAt: Date;
}

export interface Conversation {
  _id: ObjectId;
  telegramId: number;
  messages: Message[];
  isActive: boolean;
  lastMessageAt: Date;
  createdAt: Date;
}

export function createNewConversation(telegramId: number): Omit<Conversation, '_id'> {
  const now = new Date();
  return {
    telegramId,
    messages: [],
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
