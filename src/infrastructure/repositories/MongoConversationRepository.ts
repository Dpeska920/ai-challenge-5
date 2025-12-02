import { ObjectId } from 'mongodb';
import type { Conversation } from '../../domain/entities/Conversation';
import type { ConversationRepository } from '../../domain/repositories/ConversationRepository';
import { getConversationsCollection } from '../database/mongodb';

export class MongoConversationRepository implements ConversationRepository {
  async findActiveByTelegramId(telegramId: number): Promise<Conversation | null> {
    const collection = getConversationsCollection();
    return collection.findOne({ telegramId, isActive: true });
  }

  async create(conversation: Omit<Conversation, '_id'>): Promise<Conversation> {
    const collection = getConversationsCollection();
    const result = await collection.insertOne(conversation as Conversation);
    return { ...conversation, _id: result.insertedId } as Conversation;
  }

  async update(conversation: Conversation): Promise<Conversation> {
    const collection = getConversationsCollection();
    const { _id, ...updateData } = conversation;
    await collection.updateOne(
      { _id: new ObjectId(_id) },
      { $set: updateData }
    );
    return conversation;
  }
}
