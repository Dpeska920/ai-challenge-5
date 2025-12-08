import type { Command, CommandContext } from './CommandHandler';
import type { UserRepository } from '../../domain/repositories/UserRepository';
import { updateChatSettings } from '../../domain/entities/User';

export class SystemPromptCommand implements Command {
  name = 'systemprompt';
  description = 'Get or set system prompt. Usage: /systemprompt [text]';

  constructor(private userRepository: UserRepository) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { user, args, sendMessage } = ctx;

    // If no args, show current setting
    if (args.length === 0) {
      const current = user.chatSettings?.systemPrompt;
      if (current === null || current === undefined) {
        await sendMessage('System prompt: default (not set)\nUse /systemprompt <text> to set');
      } else {
        const truncated = current.length > 200 ? current.slice(0, 200) + '...' : current;
        await sendMessage(`System prompt: ${truncated}\n\nUse /systemprompt <text> to change, or /systemprompt reset to use default`);
      }
      return;
    }

    // Handle reset
    if (args.length === 1 && args[0].toLowerCase() === 'reset') {
      const updatedUser = updateChatSettings(user, { systemPrompt: null });
      await this.userRepository.update(updatedUser);
      await sendMessage('System prompt reset to default.');
      return;
    }

    // Join all args as the prompt text
    const promptText = args.join(' ');

    // Update user settings
    const updatedUser = updateChatSettings(user, { systemPrompt: promptText });
    await this.userRepository.update(updatedUser);
    await sendMessage(`System prompt set to:\n${promptText.length > 200 ? promptText.slice(0, 200) + '...' : promptText}`);
  }
}
