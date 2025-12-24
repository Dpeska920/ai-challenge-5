import type { Command, CommandContext } from './CommandHandler';
import type { UserRepository } from '../../domain/repositories/UserRepository';
import { updateChatSettings, type RerankMode } from '../../domain/entities/User';

const VALID_MODES: RerankMode[] = ['off', 'cross', 'llm'];

const MODE_DESCRIPTIONS: Record<RerankMode, string> = {
  off: 'No reranking (basic vector search)',
  cross: 'Cross-encoder reranking (BAAI/bge-reranker-v2-m3)',
  llm: 'LLM reranking (query expansion + LLM scoring)',
};

export class RagRerankCommand implements Command {
  name = 'ragrerank';
  description = 'Get or set RAG reranking mode. Usage: /ragrerank [off|cross|llm]';

  constructor(private userRepository: UserRepository) {}

  async execute(ctx: CommandContext): Promise<void> {
    const { user, args, sendMessage } = ctx;

    // If no args, show current setting
    if (args.length === 0) {
      const current = user.chatSettings?.rerankMode ?? 'off';
      const modesList = VALID_MODES.map(m =>
        `• <b>${m}</b>${m === current ? ' ✓' : ''} - ${MODE_DESCRIPTIONS[m]}`
      ).join('\n');

      await sendMessage(
        `🔄 <b>RAG Rerank Mode:</b> ${current}\n\n<b>Available modes:</b>\n${modesList}\n\nUse /ragrerank &lt;mode&gt; to change`,
        { parseMode: 'HTML' }
      );
      return;
    }

    const mode = args[0].toLowerCase();

    // Validate mode
    if (!VALID_MODES.includes(mode as RerankMode)) {
      await sendMessage(
        `❌ Invalid mode: ${mode}\n\nValid modes: ${VALID_MODES.join(', ')}`,
        { parseMode: 'HTML' }
      );
      return;
    }

    // Update user settings
    const updatedUser = updateChatSettings(user, { rerankMode: mode as RerankMode });
    await this.userRepository.update(updatedUser);

    await sendMessage(
      `✅ RAG rerank mode set to: <b>${mode}</b>\n\n${MODE_DESCRIPTIONS[mode as RerankMode]}`,
      { parseMode: 'HTML' }
    );
  }
}
