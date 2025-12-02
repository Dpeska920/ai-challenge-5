import type { Command, CommandContext } from './CommandHandler';
import { LimitService } from '../../domain/services/LimitService';

export class StatusCommand implements Command {
  name = 'status';
  description = 'Show your current usage and limits';

  constructor(private limitService: LimitService) {}

  async execute(ctx: CommandContext): Promise<void> {
    const status = this.limitService.formatUsageStatus(ctx.user);
    await ctx.sendMessage(status);
  }
}
