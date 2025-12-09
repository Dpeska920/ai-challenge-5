import type { Command, CommandContext } from './CommandHandler';
import type { UserRepository } from '../../domain/repositories/UserRepository';
import { updateChatSettings } from '../../domain/entities/User';

export class ModelCommand implements Command {
  name = 'model';
  description = 'Get or set AI model (OpenRouter). Usage: /model [model_name]';

  constructor(
    private userRepository: UserRepository,
    private openRouterEnabled: boolean
  ) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { user, args, sendMessage } = ctx;

    // Check if OpenRouter is configured
    if (!this.openRouterEnabled) {
      await sendMessage('OpenRouter is not configured. Contact admin to set OPENROUTER_API_KEY.');
      return;
    }

    // If no args, show current setting
    if (args.length === 0) {
      const current = user.chatSettings?.model;
      if (current === null || current === undefined) {
        await sendMessage(
          'Model: default (using main provider)\n\n' +
            'Use /model <model_name> to switch to OpenRouter\n' +
            'Example: /model anthropic/claude-3.5-sonnet\n\n' +
            'Popular models:\n' +
            '• anthropic/claude-3.5-sonnet\n' +
            '• openai/gpt-4o\n' +
            '• google/gemini-pro-1.5\n' +
            '• meta-llama/llama-3.1-70b-instruct'
        );
      } else {
        await sendMessage(`Model: ${current}\n\nUse /model reset to switch back to default provider`);
      }
      return;
    }

    // Handle reset
    if (args[0].toLowerCase() === 'reset') {
      const updatedUser = updateChatSettings(user, { model: null });
      await this.userRepository.update(updatedUser);
      await sendMessage('Model reset to default provider.');
      return;
    }

    // Set model
    const modelName = args[0];
    const updatedUser = updateChatSettings(user, { model: modelName });
    await this.userRepository.update(updatedUser);
    await sendMessage(`Model set to: ${modelName}\n\nNow using OpenRouter. Use /model reset to switch back.`);
  }
}
