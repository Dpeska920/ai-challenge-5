import type { Command, CommandContext } from './CommandHandler';
import type { UserRepository } from '../../domain/repositories/UserRepository';
import { updateChatSettings } from '../../domain/entities/User';

export class MaxTokensCommand implements Command {
  name = 'maxtokens';
  description = 'Get or set max tokens for AI response. Usage: /maxtokens [value]';

  constructor(private userRepository: UserRepository) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { user, args, sendMessage } = ctx;

    // If no args, show current setting
    if (args.length === 0) {
      const current = user.chatSettings?.maxTokens;
      if (current === null || current === undefined) {
        await sendMessage('Max tokens: default (not set)\nUse /maxtokens <value> to set (1 - 16000)');
      } else {
        await sendMessage(`Max tokens: ${current}\nUse /maxtokens <value> to change, or /maxtokens reset to use default`);
      }
      return;
    }

    // Handle reset
    if (args[0].toLowerCase() === 'reset') {
      const updatedUser = updateChatSettings(user, { maxTokens: null });
      await this.userRepository.update(updatedUser);
      await sendMessage('Max tokens reset to default.');
      return;
    }

    // Parse and validate value
    const value = parseInt(args[0], 10);
    if (isNaN(value) || value < 1 || value > 16000) {
      await sendMessage('Invalid value. Max tokens must be a number between 1 and 16000');
      return;
    }

    // Update user settings
    const updatedUser = updateChatSettings(user, { maxTokens: value });
    await this.userRepository.update(updatedUser);
    await sendMessage(`Max tokens set to ${value}`);
  }
}
