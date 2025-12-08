import type { Command, CommandContext } from './CommandHandler';
import type { UserRepository } from '../../domain/repositories/UserRepository';
import { updateChatSettings, type ChatResponseFormat } from '../../domain/entities/User';

const VALID_FORMATS: ChatResponseFormat[] = ['text', 'json_object'];

export class ResponseFormatCommand implements Command {
  name = 'responseformat';
  description = 'Get or set response format. Usage: /responseformat [text|json_object]';

  constructor(private userRepository: UserRepository) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { user, args, sendMessage } = ctx;

    // If no args, show current setting
    if (args.length === 0) {
      const current = user.chatSettings?.responseFormat;
      if (current === null || current === undefined) {
        await sendMessage('Response format: default (not set)\nUse /responseformat <text|json_object> to set');
      } else {
        await sendMessage(`Response format: ${current}\nUse /responseformat <text|json_object> to change, or /responseformat reset to use default`);
      }
      return;
    }

    // Handle reset
    if (args[0].toLowerCase() === 'reset') {
      const updatedUser = updateChatSettings(user, { responseFormat: null });
      await this.userRepository.update(updatedUser);
      await sendMessage('Response format reset to default.');
      return;
    }

    // Validate format
    const format = args[0].toLowerCase() as ChatResponseFormat;
    if (!VALID_FORMATS.includes(format)) {
      await sendMessage(`Invalid format. Valid options: ${VALID_FORMATS.join(', ')}`);
      return;
    }

    // Update user settings
    const updatedUser = updateChatSettings(user, { responseFormat: format });
    await this.userRepository.update(updatedUser);
    await sendMessage(`Response format set to ${format}`);
  }
}
