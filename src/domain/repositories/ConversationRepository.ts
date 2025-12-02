import type { Conversation } from '../entities/Conversation';

export interface ConversationRepository {
  findActiveByTelegramId(telegramId: number): Promise<Conversation | null>;
  create(conversation: Omit<Conversation, '_id'>): Promise<Conversation>;
  update(conversation: Conversation): Promise<Conversation>;
}
