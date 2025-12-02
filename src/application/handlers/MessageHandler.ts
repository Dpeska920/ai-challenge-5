import type { UserRepository } from '../../domain/repositories/UserRepository';
import type { Config } from '../../config/env';
import { createNewUser } from '../../domain/entities/User';
import { ActivateUserUseCase } from '../usecases/ActivateUser';
import { CheckLimitsUseCase } from '../usecases/CheckLimits';
import { SendAIMessageUseCase } from '../usecases/SendAIMessage';
import { commandRegistry } from '../commands/CommandHandler';
import { LimitService } from '../../domain/services/LimitService';
import { log } from '../../utils/logger';

export interface SendMessageOptions {
  parseMode?: 'HTML' | 'MarkdownV2';
}

export interface MessageContext {
  telegramId: number;
  username?: string;
  firstName?: string;
  text: string;
  sendMessage: (text: string, options?: SendMessageOptions) => Promise<void>;
}

export class MessageHandler {
  private activateUserUseCase: ActivateUserUseCase;
  private checkLimitsUseCase: CheckLimitsUseCase;
  private sendAIMessageUseCase: SendAIMessageUseCase;
  private limitService: LimitService;

  constructor(
    private userRepository: UserRepository,
    private config: Config,
    activateUserUseCase: ActivateUserUseCase,
    checkLimitsUseCase: CheckLimitsUseCase,
    sendAIMessageUseCase: SendAIMessageUseCase,
    limitService: LimitService
  ) {
    this.activateUserUseCase = activateUserUseCase;
    this.checkLimitsUseCase = checkLimitsUseCase;
    this.sendAIMessageUseCase = sendAIMessageUseCase;
    this.limitService = limitService;
  }

  async handle(ctx: MessageContext): Promise<void> {
    const { telegramId, username, firstName, text, sendMessage } = ctx;

    log('info', 'Message received', { telegramId, textLength: text.length });

    // 1. Get or create user
    let user = await this.userRepository.findByTelegramId(telegramId);

    if (!user) {
      const newUser = createNewUser(telegramId, username, firstName);
      user = await this.userRepository.create(newUser);
      log('info', 'New user created', { telegramId });
    }

    // 2. Handle non-activated users
    if (!user.isActivated) {
      if (text === this.config.activationCode) {
        const result = await this.activateUserUseCase.execute({
          user,
          defaultLimits: this.config.defaultLimits,
        });
        user = result.user;
        await sendMessage('Bot activated! You can now start chatting. Send /help for available commands.');
        return;
      } else {
        await sendMessage('Bot is not activated. Please enter the activation code.');
        return;
      }
    }

    // 3. Check if it's a command
    if (text.startsWith('/')) {
      const parts = text.slice(1).split(' ');
      const commandName = parts[0];
      const args = parts.slice(1);

      const command = commandRegistry.get(commandName);
      if (command) {
        await command.execute({
          user,
          telegramId,
          sendMessage,
          args,
        });
        return;
      } else {
        await sendMessage(`Unknown command: /${commandName}. Use /help to see available commands.`);
        return;
      }
    }

    // 4. Check limits before processing
    const { user: updatedUser, checkResult } = await this.checkLimitsUseCase.execute({ user });
    user = updatedUser;

    if (!checkResult.allowed) {
      const errorMessage = this.limitService.formatLimitError(checkResult);
      await sendMessage(errorMessage);
      return;
    }

    // 5. Process AI message
    try {
      const result = await this.sendAIMessageUseCase.execute({
        user,
        telegramId,
        message: text,
        conversationTimeoutHours: this.config.conversationTimeoutHours,
      });

      await sendMessage(result.response);
    } catch (error) {
      log('error', 'Error processing AI message', {
        telegramId,
        error: error instanceof Error ? error.message : String(error),
      });
      await sendMessage('Sorry, an error occurred while processing your message. Please try again later.');
    }
  }
}
