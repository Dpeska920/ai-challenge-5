import type { UserRepository } from '../../domain/repositories/UserRepository';
import type { ConversationRepository } from '../../domain/repositories/ConversationRepository';
import type { Config } from '../../config/env';
import { createNewUser } from '../../domain/entities/User';
import { isConversationExpired, deactivateConversation } from '../../domain/entities/Conversation';
import { ActivateUserUseCase } from '../usecases/ActivateUser';
import { CheckLimitsUseCase } from '../usecases/CheckLimits';
import { SendAIMessageUseCase } from '../usecases/SendAIMessage';
import { commandRegistry } from '../commands/CommandHandler';
import { LimitService } from '../../domain/services/LimitService';
import type { GameCreationService } from '../../domain/services/GameCreationService';
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
  private gameCreationService: GameCreationService;
  private conversationRepo: ConversationRepository;

  constructor(
    private userRepository: UserRepository,
    private config: Config,
    activateUserUseCase: ActivateUserUseCase,
    checkLimitsUseCase: CheckLimitsUseCase,
    sendAIMessageUseCase: SendAIMessageUseCase,
    limitService: LimitService,
    gameCreationService: GameCreationService,
    conversationRepo: ConversationRepository
  ) {
    this.activateUserUseCase = activateUserUseCase;
    this.checkLimitsUseCase = checkLimitsUseCase;
    this.sendAIMessageUseCase = sendAIMessageUseCase;
    this.limitService = limitService;
    this.gameCreationService = gameCreationService;
    this.conversationRepo = conversationRepo;
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

    // 5. Get active conversation to determine type
    let conversation = await this.conversationRepo.findActiveByTelegramId(telegramId);

    // Check if conversation is expired
    if (conversation && isConversationExpired(conversation, this.config.conversationTimeoutHours)) {
      const deactivated = deactivateConversation(conversation);
      await this.conversationRepo.update(deactivated);
      conversation = null;
      log('info', 'Conversation expired and deactivated', { telegramId });
    }

    // 6. Route based on conversation type
    if (conversation?.type === 'gamecreation') {
      // Handle gamecreation conversation
      try {
        const result = await this.gameCreationService.processMessage(user, conversation, text);
        await sendMessage(result.response, result.parseMode ? { parseMode: result.parseMode } : undefined);
      } catch (error) {
        log('error', 'Error processing gamecreation message', {
          telegramId,
          error: error instanceof Error ? error.message : String(error),
        });
        await sendMessage('Произошла ошибка при обработке. Попробуйте позже.');
      }
    } else {
      // Handle regular chat conversation
      try {
        const result = await this.sendAIMessageUseCase.execute({
          user,
          telegramId,
          message: text,
          conversationTimeoutHours: this.config.conversationTimeoutHours,
        });

        await sendMessage(result.response, result.parseMode ? { parseMode: result.parseMode } : undefined);
      } catch (error) {
        log('error', 'Error processing AI message', {
          telegramId,
          error: error instanceof Error ? error.message : String(error),
        });
        await sendMessage('Sorry, an error occurred while processing your message. Please try again later.');
      }
    }
  }
}
