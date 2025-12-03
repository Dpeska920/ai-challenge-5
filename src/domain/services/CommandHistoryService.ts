import type { CommandHistoryRepository } from '../repositories/CommandHistoryRepository';
import type { CommandHistory, CommandStatus, CreateCommandHistoryInput } from '../entities/CommandHistory';
import { createCommandHistory } from '../entities/CommandHistory';

export class CommandHistoryService {
  constructor(private repository: CommandHistoryRepository) {}

  async log(
    telegramId: number,
    commandName: string,
    input: string,
    status: CommandStatus,
    errorMessage?: string
  ): Promise<CommandHistory> {
    const historyInput: CreateCommandHistoryInput = {
      telegramId,
      commandName,
      input,
      status,
      errorMessage,
    };
    return this.repository.create(createCommandHistory(historyInput));
  }

  async getHistory(telegramId: number, limit?: number): Promise<CommandHistory[]> {
    return this.repository.findByTelegramId(telegramId, limit);
  }

  async getCommandCount(telegramId: number): Promise<number> {
    return this.repository.countByTelegramId(telegramId);
  }
}
