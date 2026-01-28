import type { Command, CommandContext } from './CommandHandler';

export class IssuesCommand implements Command {
  name = 'issues';
  description = 'Show open issues (requires /github to be set)';

  async execute(ctx: CommandContext): Promise<void> {
    const { user, sendMessage } = ctx;

    const repo = user.chatSettings?.githubRepo;
    if (!repo) {
      await sendMessage('Set repository first: /github owner/repo');
      return;
    }

    await sendMessage(
      `To see issues, just ask me:\n\n` +
        `"Show open issues"\n` +
        `"What tasks are there?"\n` +
        `"Issues with bug label"\n\n` +
        `I will use GitHub tools automatically.`
    );
  }
}
