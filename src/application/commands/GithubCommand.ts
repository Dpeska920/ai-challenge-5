import type { Command, CommandContext } from './CommandHandler';
import type { UserRepository } from '../../domain/repositories/UserRepository';
import { updateChatSettings } from '../../domain/entities/User';

export class GithubCommand implements Command {
  name = 'github';
  description = 'Set active GitHub repository (format: owner/repo)';

  constructor(private userRepository: UserRepository) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { user, args, sendMessage } = ctx;

    if (args.length === 0) {
      const currentRepo = user.chatSettings?.githubRepo;
      if (currentRepo) {
        await sendMessage(
          `Current repository: <code>${currentRepo}</code>\n\nTo change: /github owner/repo`
        );
      } else {
        await sendMessage('Repository not set.\n\nUsage: /github owner/repo');
      }
      return;
    }

    const repo = args.join(' ').trim();

    const repoRegex = /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/;
    if (!repoRegex.test(repo)) {
      await sendMessage('Invalid format. Use: owner/repo');
      return;
    }

    const updatedUser = updateChatSettings(user, { githubRepo: repo });
    await this.userRepository.update(updatedUser);

    await sendMessage(`Repository set: <code>${repo}</code>`);
  }
}
