import type { Command, CommandContext } from './CommandHandler';
import { commandRegistry } from './CommandHandler';

export class HelpCommand implements Command {
  name = 'help';
  description = 'Show list of available commands';

  async execute(ctx: CommandContext): Promise<void> {
    const commands = commandRegistry.getAllDescriptions();
    const helpText = [
      'Available commands:',
      '',
      ...commands.map((cmd) => `/${cmd.name} - ${cmd.description}`),
      '',
      'You can also send any message to chat with AI.',
    ].join('\n');

    await ctx.sendMessage(helpText);
  }
}
