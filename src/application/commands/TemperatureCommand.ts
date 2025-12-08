import type { Command, CommandContext } from './CommandHandler';
import type { UserRepository } from '../../domain/repositories/UserRepository';
import { updateChatSettings } from '../../domain/entities/User';

export class TemperatureCommand implements Command {
  name = 'temperature';
  description = 'Get or set AI temperature (0.0 - 2.0). Usage: /temperature [value]';

  constructor(private userRepository: UserRepository) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { user, args, sendMessage } = ctx;

    // If no args, show current setting
    if (args.length === 0) {
      const current = user.chatSettings?.temperature;
      if (current === null || current === undefined) {
        await sendMessage('Temperature: default (not set)\nUse /temperature <value> to set (0.0 - 2.0)');
      } else {
        await sendMessage(`Temperature: ${current}\nUse /temperature <value> to change, or /temperature reset to use default`);
      }
      return;
    }

    // Handle reset
    if (args[0].toLowerCase() === 'reset') {
      const updatedUser = updateChatSettings(user, { temperature: null });
      await this.userRepository.update(updatedUser);
      await sendMessage('Temperature reset to default.');
      return;
    }

    // Parse and validate value
    const value = parseFloat(args[0]);
    if (isNaN(value) || value < 0 || value > 2) {
      await sendMessage('Invalid value. Temperature must be a number between 0.0 and 2.0');
      return;
    }

    // Update user settings
    const updatedUser = updateChatSettings(user, { temperature: value });
    await this.userRepository.update(updatedUser);
    await sendMessage(`Temperature set to ${value}`);
  }
}
