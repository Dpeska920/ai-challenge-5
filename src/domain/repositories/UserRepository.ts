import type { User } from '../entities/User';

export interface UserRepository {
  findByTelegramId(telegramId: number): Promise<User | null>;
  create(user: Omit<User, '_id'>): Promise<User>;
  update(user: User): Promise<User>;
}
