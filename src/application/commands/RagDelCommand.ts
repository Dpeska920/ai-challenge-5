import type { Command, CommandContext } from './CommandHandler';
import type { RagService } from '../../domain/services/RagService';

export class RagDelCommand implements Command {
  name = 'ragdel';
  description = 'Delete a RAG document';

  constructor(private ragService: RagService) {}

  async execute(ctx: CommandContext): Promise<void> {
    const filename = ctx.args.join(' ').trim();

    if (!filename) {
      await ctx.sendMessage('❌ Please specify filename to delete.\n\nUsage: /ragdel <filename>\nExample: /ragdel my-doc.md');
      return;
    }

    try {
      const result = await this.ragService.deleteDocument(filename);

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
