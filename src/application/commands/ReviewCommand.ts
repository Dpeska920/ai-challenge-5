import type { Command, CommandContext } from './CommandHandler';

export class ReviewCommand implements Command {
  name = 'review';
  description = 'Start AI review of Pull Request';

  async execute(ctx: CommandContext): Promise<void> {
    const { user, args, sendMessage } = ctx;

    const repo = user.chatSettings?.githubRepo;
    if (!repo) {
      await sendMessage('Set repository first: /github owner/repo');
      return;
    }

    if (args.length === 0) {
      await sendMessage('Usage: /review <PR number>\n\nExample: /review 42');
      return;
    }

    const prNumber = parseInt(args[0], 10);
    if (isNaN(prNumber) || prNumber <= 0) {
      await sendMessage('Specify a valid PR number');
      return;
    }

    await sendMessage(
      `To review PR #${prNumber}, just write:\n\n` +
        `"Review PR #${prNumber}"\n` +
        `"Code review for pull request ${prNumber}"\n\n` +
        `I will analyze changes and provide feedback.`
    );
  }
}
