import type { Command, CommandContext } from './CommandHandler';
import type { UserRepository } from '../../domain/repositories/UserRepository';
import { updateProfile } from '../../domain/entities/User';

export class SetTimezoneCommand implements Command {
  name = 'settimezone';
  description = 'Set your timezone. Usage: /settimezone [timezone]';

  constructor(private userRepository: UserRepository) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { user, args, sendMessage } = ctx;

    // If no args, reset timezone
    if (args.length === 0) {
      const updatedUser = updateProfile(user, { timezone: null });
      await this.userRepository.update(updatedUser);
      await sendMessage('Timezone cleared (will use default: Europe/Moscow).');
      return;
    }

    // Validate timezone
    const timezone = args[0];
    try {
      // Try to format date with this timezone to validate it
      new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
    } catch {
      await sendMessage(`Invalid timezone: ${timezone}\nExamples: Europe/Moscow, America/New_York, Asia/Tokyo`);
      return;
    }

    const updatedUser = updateProfile(user, { timezone });
    await this.userRepository.update(updatedUser);
    await sendMessage(`Timezone set to: ${timezone}`);
  }
}
