import type { Command, CommandContext } from './CommandHandler';
import type { UserRepository } from '../../domain/repositories/UserRepository';
import { updateProfile } from '../../domain/entities/User';

export class PersonalizationCommand implements Command {
  name = 'personalization';
  description = 'Set personal info (profession, preferences, style). Usage: /personalization [text]';

  constructor(private userRepository: UserRepository) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { user, args, sendMessage } = ctx;

    if (args.length === 0) {
      const current = user.profile?.personalization;
      if (current === null || current === undefined) {
        await sendMessage(
          'Personalization: not set\n\n' +
          'Tell me about yourself - profession, preferences, communication style.\n' +
          'Example: /personalization Senior developer, prefer concise answers, like code examples'
        );
      } else {
        const truncated = current.length > 300 ? current.slice(0, 300) + '...' : current;
        await sendMessage(
          `Personalization:\n${truncated}\n\n` +
          'Use /personalization <text> to change\n' +
          'Use /personalization reset to clear'
        );
      }
      return;
    }

    if (args.length === 1 && args[0].toLowerCase() === 'reset') {
      const updatedUser = updateProfile(user, { personalization: null });
      await this.userRepository.update(updatedUser);
      await sendMessage('Personalization cleared.');
      return;
    }

    const text = args.join(' ');

    if (text.length > 1000) {
      await sendMessage('Personalization text is too long (max 1000 characters).');
      return;
    }

    const updatedUser = updateProfile(user, { personalization: text });
    await this.userRepository.update(updatedUser);

    const truncated = text.length > 200 ? text.slice(0, 200) + '...' : text;
    await sendMessage(`Personalization set:\n${truncated}`);
  }
}
