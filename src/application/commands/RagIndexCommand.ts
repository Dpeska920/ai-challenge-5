import type { Command, CommandContext } from './CommandHandler';
import type { RagService } from '../../domain/services/RagService';

export class RagIndexCommand implements Command {
  name = 'ragindex';
  description = 'Reindex all RAG documents';

  constructor(private ragService: RagService) {}

  async execute(ctx: CommandContext): Promise<void> {
    try {
      await ctx.sendMessage('⏳ Starting reindex...');

      const result = await this.ragService.reindex();

      if (result.success) {
        await ctx.sendMessage(`✅ ${result.message}`);
      } else {
        await ctx.sendMessage(`❌ ${result.message}`);
      }
    } catch (error) {
      await ctx.sendMessage(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
