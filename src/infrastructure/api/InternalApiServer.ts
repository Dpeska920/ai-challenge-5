import { Bot } from 'grammy';
import { log } from '../../utils/logger';
import type { UserRepository } from '../../domain/repositories/UserRepository';
import type { SendAIMessageUseCase } from '../../application/usecases/SendAIMessage';
import { createNewUser } from '../../domain/entities/User';

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

    let splitIndex = remaining.lastIndexOf('\n', maxLength);

    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = remaining.lastIndexOf(' ', maxLength);
    }

    if (splitIndex === -1 || splitIndex < maxLength / 2) {
      splitIndex = maxLength;
    }

    parts.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }

  return parts;
}

interface ReminderPayload {
  telegramId: number;
  message: string;
  scheduledAt: string;
  isRepeatable?: boolean;
  repeatInterval?: string;
}

export class InternalApiServer {
  private server: ReturnType<typeof Bun.serve> | null = null;

  constructor(
    private bot: Bot,
    private userRepository: UserRepository,
    private sendAIMessageUseCase: SendAIMessageUseCase,
    private conversationTimeoutHours: number,
    private timezone: string = 'Europe/Moscow',
    private port: number = 3000
  ) {}

  async start(): Promise<void> {
    const bot = this.bot;

    this.server = Bun.serve({
      port: this.port,
      fetch: async (req) => {
        const url = new URL(req.url);

        // Health check
        if (url.pathname === '/health' && req.method === 'GET') {
          return Response.json({ status: 'ok' });
        }

        // Send reminder endpoint (from scheduler)
        // Processes reminder as full AI request with MCP tools support
        if (url.pathname === '/internal/send-reminder' && req.method === 'POST') {
          try {
            const body = await req.json() as ReminderPayload;
            const { telegramId, message, scheduledAt } = body;

            if (!telegramId || !message) {
              return Response.json(
                { error: 'telegramId and message are required' },
                { status: 400 }
              );
            }

            // Get or create user
            let user = await this.userRepository.findByTelegramId(telegramId);
            if (!user) {
              const newUser = createNewUser(telegramId);
              user = await this.userRepository.create(newUser);
            }

            // Format reminder context for AI
            const formattedTime = new Date(scheduledAt).toLocaleString('ru-RU', {
              timeZone: this.timezone,
              weekday: 'long',
              day: 'numeric',
              month: 'long',
              hour: '2-digit',
              minute: '2-digit'
            });

            const reminderPrompt = `[НАПОМИНАНИЕ запланированное на ${formattedTime}]
Пользователь просил напомнить: "${message}"

Выполни это напоминание. Если в тексте есть задача (например, получить статистику или данные) - выполни её с помощью доступных инструментов. Если это просто напоминание - напиши его дружелюбно своими словами.`;

            // Process as full AI request with MCP tools
            const result = await this.sendAIMessageUseCase.execute({
              user,
              telegramId,
              message: reminderPrompt,
              conversationTimeoutHours: this.conversationTimeoutHours,
            });

            // Send response to Telegram
            const parts = splitMessage(result.response);
            for (const part of parts) {
              await bot.api.sendMessage(telegramId, part, {
                parse_mode: result.parseMode,
              });
            }

            log('info', 'Internal API: Reminder processed with AI', { telegramId });
            return Response.json({ success: true });
          } catch (error) {
            log('error', 'Internal API: Failed to process reminder', {
              error: error instanceof Error ? error.message : String(error),
            });
            return Response.json(
              { error: 'Failed to process reminder' },
              { status: 500 }
            );
          }
        }

        // Send plain message endpoint (internal only)
        if (url.pathname === '/internal/send-message' && req.method === 'POST') {
          try {
            const body = await req.json() as { telegramId?: number; message?: string };
            const { telegramId, message } = body;

            if (!telegramId || !message) {
              return Response.json(
                { error: 'telegramId and message are required' },
                { status: 400 }
              );
            }

            const parts = splitMessage(message);
            for (const part of parts) {
              await bot.api.sendMessage(telegramId, part);
            }

            log('info', 'Internal API: Message sent', { telegramId });
            return Response.json({ success: true });
          } catch (error) {
            log('error', 'Internal API: Failed to send message', {
              error: error instanceof Error ? error.message : String(error),
            });
            return Response.json(
              { error: 'Failed to send message' },
              { status: 500 }
            );
          }
        }

        return Response.json({ error: 'Not found' }, { status: 404 });
      },
    });

    log('info', `Internal API server running on port ${this.port}`);
  }

  stop(): void {
    if (this.server) {
      this.server.stop();
      log('info', 'Internal API server stopped');
    }
  }
}
