import { Bot, Context } from 'grammy';
import type { MessageHandler } from '../../application/handlers/MessageHandler';
import { log } from '../../utils/logger';

const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

function splitMessage(text: string, maxLength: number = TELEGRAM_MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const parts: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      parts.push(remaining);
      break;
    }

    // Try to split at a newline
    let splitIndex = remaining.lastIndexOf('\n', maxLength);

    // If no newline found, try to split at a space
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }

    // If still no good split point, just cut at maxLength
    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    parts.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return parts;
}

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
          const parts = splitMessage(text);
          for (const part of parts) {
            await ctx.reply(part, { parse_mode: options?.parseMode });
          }
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
