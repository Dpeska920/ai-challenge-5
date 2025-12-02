import { Bot, Context } from 'grammy';
import type { MessageHandler } from '../../application/handlers/MessageHandler';
import { log } from '../../utils/logger';

export class TelegramBot {
  private bot: Bot;

  constructor(token: string, private messageHandler: MessageHandler) {
    this.bot = new Bot(token);
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // Handle text messages
    this.bot.on('message:text', async (ctx: Context) => {
      const message = ctx.message;
      if (!message || !message.text) return;

      const telegramId = ctx.from?.id;
      if (!telegramId) return;

      await this.messageHandler.handle({
        telegramId,
        username: ctx.from?.username,
        firstName: ctx.from?.first_name,
        text: message.text,
        sendMessage: async (text: string, options?: { parseMode?: 'HTML' | 'MarkdownV2' }) => {
          await ctx.reply(text, { parse_mode: options?.parseMode });
        },
      });
    });

    // Handle errors
    this.bot.catch((err) => {
      log('error', 'Bot error', {
        error: err.message,
        stack: err.stack,
      });
    });
  }

  async start(): Promise<void> {
    log('info', 'Starting Telegram bot...');
    await this.bot.start({
      onStart: (botInfo) => {
        log('info', `Bot started as @${botInfo.username}`);
      },
    });
  }

  async stop(): Promise<void> {
    log('info', 'Stopping Telegram bot...');
    await this.bot.stop();
    log('info', 'Telegram bot stopped');
  }

  getBot(): Bot {
    return this.bot;
  }
}
