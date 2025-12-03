import type { Command, CommandContext } from './CommandHandler';
import type { ConversationRepository } from '../../domain/repositories/ConversationRepository';
import type { LimitService } from '../../domain/services/LimitService';
import type { CommandHistoryService } from '../../domain/services/CommandHistoryService';
import { createNewConversation, deactivateConversation } from '../../domain/entities/Conversation';
import { log } from '../../utils/logger';

export const GAMECREATION_SYSTEM_PROMPT = `You are a game concept assistant helping users define their game idea. You MUST collect 3 pieces of information:
1. Genre - the game's genre (RPG, action, puzzle, strategy, etc.)
2. Plot - the main story/setting idea
3. Gameplay - core gameplay mechanics and features

IMPORTANT RULES:
- You MUST ALWAYS respond with a valid JSON object
- Keep your messages friendly and conversational in Russian
- Ask follow-up questions to clarify vague answers
- When user mentions something, acknowledge it and ask about missing pieces
- Only output the final result when ALL 3 elements are clearly defined

Response format (ALWAYS use one of these):

When still collecting information:
{"status": "collecting", "message": "Your conversational response in Russian asking for more details or confirming what you understood"}

When all 3 elements are clearly defined:
{"status": "complete", "game": {"genre": "the genre", "plot": "summary of the plot/setting", "gameplay": "summary of gameplay mechanics"}}

Examples of "collecting" responses:
- User says they want an RPG: {"status": "collecting", "message": "Отлично, RPG! Расскажите, какой сеттинг или сюжет вы представляете? И какие особенности геймплея хотите видеть?"}
- User describes combat system: {"status": "collecting", "message": "Понял, боевая система со сражениями. А какой жанр и сюжет вы хотите?"}

Example of "complete" response:
{"status": "complete", "game": {"genre": "RPG", "plot": "Мир мишек Гамми, где герои сражаются за право стать белым медведем", "gameplay": "Сражения с противниками, экипировка персонажа, призыв армии желейных мишек"}}

Remember: NEVER output plain text. ALWAYS output valid JSON.`;

export class GameCreationCommand implements Command {
  name = 'gamecreation';
  description = 'Start a guided game concept creation session';

  constructor(
    private conversationRepo: ConversationRepository,
    private limitService: LimitService,
    private commandHistoryService: CommandHistoryService
  ) {}

  async execute(ctx: CommandContext): Promise<void> {
    // Check limits before starting
    const { checkResult } = await this.limitService.checkAndResetLimits(ctx.user);

    if (!checkResult.allowed) {
      const errorMessage = this.limitService.formatLimitError(checkResult);
      await ctx.sendMessage(errorMessage);
      await this.commandHistoryService.log(ctx.telegramId, this.name, '', 'limit_exceeded');
      return;
    }

    try {
      // Deactivate any existing active conversation
      const existingConversation = await this.conversationRepo.findActiveByTelegramId(ctx.telegramId);
      if (existingConversation) {
        const deactivated = deactivateConversation(existingConversation);
        await this.conversationRepo.update(deactivated);
        log('info', 'Deactivated existing conversation for gamecreation', { telegramId: ctx.telegramId });
      }

      // Create new gamecreation conversation
      const newConversation = createNewConversation(ctx.telegramId, 'gamecreation');
      await this.conversationRepo.create(newConversation);

      log('info', 'Created gamecreation conversation', { telegramId: ctx.telegramId });

      // Send welcome message
      const welcomeMessage = `🎮 *Создание концепции игры*

Привет\\! Я помогу тебе оформить идею игры\\. Мне нужно узнать 3 вещи:

1\\. *Жанр* — какой тип игры \\(RPG, экшен, пазл и т\\.д\\.\\)
2\\. *Сюжет* — основная идея истории/сеттинга
3\\. *Геймплей* — ключевые механики

Расскажи свою идею в свободной форме, а я буду задавать уточняющие вопросы\\!`;

      await ctx.sendMessage(welcomeMessage, { parseMode: 'MarkdownV2' });
      await this.commandHistoryService.log(ctx.telegramId, this.name, '', 'success');

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      log('error', 'GameCreationCommand error', { error: errorMsg, telegramId: ctx.telegramId });
      await ctx.sendMessage('Произошла ошибка при создании сессии. Попробуйте позже.');
      await this.commandHistoryService.log(ctx.telegramId, this.name, '', 'error', errorMsg);
    }
  }
}
