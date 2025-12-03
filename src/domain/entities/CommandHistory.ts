import { ObjectId } from 'mongodb';

export type CommandStatus = 'success' | 'error' | 'limit_exceeded';

export interface CommandHistory {
  _id: ObjectId;
  telegramId: number;
  commandName: string;
  input: string;
  status: CommandStatus;
  errorMessage?: string;
  createdAt: Date;
}

export interface CreateCommandHistoryInput {
  telegramId: number;
  commandName: string;
  input: string;
  status: CommandStatus;
  errorMessage?: string;
}

export function createCommandHistory(input: CreateCommandHistoryInput): Omit<CommandHistory, '_id'> {
  return {
    telegramId: input.telegramId,
    commandName: input.commandName,
    input: input.input,
    status: input.status,
    errorMessage: input.errorMessage,
    createdAt: new Date(),
  };
}
