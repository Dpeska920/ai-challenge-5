import { MongoClient, Db, Collection } from 'mongodb';
import type { User } from '../../domain/entities/User';
import type { Conversation } from '../../domain/entities/Conversation';
import type { CommandHistory } from '../../domain/entities/CommandHistory';
import { log } from '../../utils/logger';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function connectToDatabase(uri: string): Promise<Db> {
  if (db) {
    return db;
  }

  log('info', 'Connecting to MongoDB...');
  client = new MongoClient(uri);
  await client.connect();
  db = client.db();
  log('info', 'Connected to MongoDB');

  return db;
}

export async function disconnectFromDatabase(): Promise<void> {
  if (client) {
    log('info', 'Disconnecting from MongoDB...');
    await client.close();
    client = null;
    db = null;
    log('info', 'Disconnected from MongoDB');
  }
}

export function getDatabase(): Db {
  if (!db) {
    throw new Error('Database not connected. Call connectToDatabase first.');
  }
  return db;
}

export function getUsersCollection(): Collection<User> {
  return getDatabase().collection<User>('users');
}

export function getConversationsCollection(): Collection<Conversation> {
  return getDatabase().collection<Conversation>('conversations');
}

export function getCommandHistoryCollection(): Collection<CommandHistory> {
  return getDatabase().collection<CommandHistory>('command_history');
}

export async function createIndexes(): Promise<void> {
  log('info', 'Creating database indexes...');

  const usersCollection = getUsersCollection();
  await usersCollection.createIndex({ telegramId: 1 }, { unique: true });

  const conversationsCollection = getConversationsCollection();
  await conversationsCollection.createIndex({ telegramId: 1, isActive: 1 });
  await conversationsCollection.createIndex({ lastMessageAt: 1 });

  const commandHistoryCollection = getCommandHistoryCollection();
  await commandHistoryCollection.createIndex({ telegramId: 1 });
  await commandHistoryCollection.createIndex({ createdAt: -1 });

  log('info', 'Database indexes created');
}
