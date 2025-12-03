import type { CommandHistory } from '../../domain/entities/CommandHistory';
import type { CommandHistoryRepository } from '../../domain/repositories/CommandHistoryRepository';
import { getCommandHistoryCollection } from '../database/mongodb';

export class MongoCommandHistoryRepository implements CommandHistoryRepository {
  async create(history: Omit<CommandHistory, '_id'>): Promise<CommandHistory> {
    const collection = getCommandHistoryCollection();
    const result = await collection.insertOne(history as CommandHistory);
    return { ...history, _id: result.insertedId } as CommandHistory;
  }

  async findByTelegramId(telegramId: number, limit = 50): Promise<CommandHistory[]> {
    const collection = getCommandHistoryCollection();
    return collection
      .find({ telegramId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }

  async countByTelegramId(telegramId: number): Promise<number> {
    const collection = getCommandHistoryCollection();
    return collection.countDocuments({ telegramId });
  }
}
