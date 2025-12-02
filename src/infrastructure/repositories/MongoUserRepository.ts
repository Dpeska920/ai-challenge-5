import { ObjectId } from 'mongodb';
import type { User } from '../../domain/entities/User';
import type { UserRepository } from '../../domain/repositories/UserRepository';
import { getUsersCollection } from '../database/mongodb';

export class MongoUserRepository implements UserRepository {
  async findByTelegramId(telegramId: number): Promise<User | null> {
    const collection = getUsersCollection();
    return collection.findOne({ telegramId });
  }

  async create(user: Omit<User, '_id'>): Promise<User> {
    const collection = getUsersCollection();
    const result = await collection.insertOne(user as User);
    return { ...user, _id: result.insertedId } as User;
  }

  async update(user: User): Promise<User> {
    const collection = getUsersCollection();
    const { _id, ...updateData } = user;
    await collection.updateOne(
      { _id: new ObjectId(_id) },
      { $set: updateData }
    );
    return user;
  }
}
