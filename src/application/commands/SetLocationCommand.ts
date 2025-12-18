import type { Command, CommandContext } from './CommandHandler';
import type { UserRepository } from '../../domain/repositories/UserRepository';
import { updateProfile } from '../../domain/entities/User';

export class SetLocationCommand implements Command {
  name = 'setlocation';
  description = 'Set your location for weather. Usage: /setlocation [city/region]';

  constructor(private userRepository: UserRepository) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { user, args, sendMessage } = ctx;

    // If no args, reset location
    if (args.length === 0) {
      const updatedUser = updateProfile(user, { location: null });
      await this.userRepository.update(updatedUser);
      await sendMessage('Location cleared.');
      return;
    }

    // Set location (join all args as it can contain spaces)
    const location = args.join(' ');
    const updatedUser = updateProfile(user, { location });
    await this.userRepository.update(updatedUser);
    await sendMessage(`Location set to: ${location}`);
  }
}
