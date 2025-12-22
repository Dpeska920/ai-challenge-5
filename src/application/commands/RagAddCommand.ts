import type { Command, CommandContext } from './CommandHandler';
import type { RagService } from '../../domain/services/RagService';

export class RagAddCommand implements Command {
  name = 'ragadd';
  description = 'Add document to RAG (send file with /ragadd caption)';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  constructor(_ragService: RagService) {}

  async execute(ctx: CommandContext): Promise<void> {
    // This command is triggered when user sends just "/ragadd" without a file
    // The actual file handling is done in TelegramBot document handler
    await ctx.sendMessage(
      '📎 To add a document, send a file (PDF, TXT, or MD) with caption:\n\n' +
      '<code>/ragadd description for AI</code>\n\n' +
      'The description helps AI understand when to use this document.\n\n' +
      'Example: <code>/ragadd Documentation about API integration</code>',
      { parseMode: 'HTML' }
    );
  }
}

export interface FileUploadContext {
  telegramId: number;
  filename: string;
  content: Buffer;
  description: string;
  sendMessage: (text: string, options?: { parseMode?: 'HTML' | 'MarkdownV2' }) => Promise<void>;
}

export async function handleRagFileUpload(
  ragService: RagService,
  ctx: FileUploadContext
): Promise<void> {
  const { filename, content, description, sendMessage } = ctx;

  // Validate extension
  const ext = filename.toLowerCase().split('.').pop();
  if (!['pdf', 'txt', 'md'].includes(ext || '')) {
    await sendMessage(`❌ Unsupported file type. Please use PDF, TXT, or MD files.`);
    return;
  }

  const descText = description ? ` (${description})` : '';
  await sendMessage(`⏳ Adding document: ${filename}${descText}...`);

  try {
    const result = await ragService.addDocument(filename, content, description);

    if (result.success) {
      const descInfo = description ? `\n📝 <i>${description}</i>` : '';
      await sendMessage(`✅ Document added and indexed: <b>${filename}</b>${descInfo}`, { parseMode: 'HTML' });
    } else {
      await sendMessage(`❌ Failed to add document: ${result.message}`);
    }
  } catch (error) {
    await sendMessage(`❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
