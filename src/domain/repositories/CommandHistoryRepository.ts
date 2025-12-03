import type { CommandHistory } from '../entities/CommandHistory';

export interface CommandHistoryRepository {
  create(history: Omit<CommandHistory, '_id'>): Promise<CommandHistory>;
  findByTelegramId(telegramId: number, limit?: number): Promise<CommandHistory[]>;
  countByTelegramId(telegramId: number): Promise<number>;
}
