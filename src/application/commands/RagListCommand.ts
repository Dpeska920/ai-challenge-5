import type { Command, CommandContext } from './CommandHandler';
import type { RagService } from '../../domain/services/RagService';

export class RagListCommand implements Command {
  name = 'raglist';
  description = 'Show list of RAG documents';

  constructor(private ragService: RagService) {}

  async execute(ctx: CommandContext): Promise<void> {
    try {
      const documents = await this.ragService.listDocuments();

      if (documents.length === 0) {
        await ctx.sendMessage('📂 No documents in RAG storage yet.\n\nUse /ragadd to add documents.');
        return;
      }

      const list = documents
        .map((doc, i) => {
          const desc = doc.description ? `\n   <i>${doc.description}</i>` : '';
          return `${i + 1}. <b>${doc.name}</b> (${doc.type}, ${this.ragService.formatSize(doc.size)})${desc}`;
        })
        .join('\n');

      await ctx.sendMessage(
        `📂 <b>RAG Documents (${documents.length})</b>\n\n${list}\n\n💡 Use /ragdel &lt;filename&gt; to delete`,
        { parseMode: 'HTML' }
      );
    } catch (error) {
      await ctx.sendMessage(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}
