import type { Command, CommandContext } from './CommandHandler';
import type { ConversationRepository } from '../../domain/repositories/ConversationRepository';
import { deactivateConversation } from '../../domain/entities/Conversation';

export class ClearCommand implements Command {
  name = 'clear';
  description = 'Clear conversation history and start fresh';

  constructor(private conversationRepo: ConversationRepository) {}

  async execute(ctx: CommandContext): Promise<void> {
    const activeConversation = await this.conversationRepo.findActiveByTelegramId(ctx.telegramId);

    if (activeConversation) {
      const deactivated = deactivateConversation(activeConversation);
      await this.conversationRepo.update(deactivated);
    }

    await ctx.sendMessage('Conversation cleared. Start a new conversation by sending a message.');
  }
}
