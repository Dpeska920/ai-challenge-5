import { ObjectId } from 'mongodb';

export type ReminderStatus = 'pending' | 'sent' | 'cancelled';

export type RepeatInterval = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Reminder {
  _id?: ObjectId;
  telegramId: number;
  message: string;
  scheduledAt: Date;
  isRepeatable: boolean;
  repeatInterval?: RepeatInterval;
  status: ReminderStatus;
  createdAt: Date;
  sentAt?: Date;
}

export interface CreateReminderParams {
  telegramId: number;
  message: string;
  scheduledAt: string; // ISO date string
  isRepeatable?: boolean;
  repeatInterval?: RepeatInterval;
}

export interface DeleteReminderParams {
  reminderId?: string;
  reminderIds?: string[];
  telegramId?: number; // Delete all for user
}

export interface ListRemindersParams {
  telegramId: number;
  status?: ReminderStatus;
  includeCompleted?: boolean;
}
