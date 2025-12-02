import type { User } from '../../domain/entities/User';
import type { Conversation } from '../../domain/entities/Conversation';
import type { ConversationRepository } from '../../domain/repositories/ConversationRepository';
import type { AIProvider } from '../../domain/services/AIProvider';
import { LimitService } from '../../domain/services/LimitService';
import {
  createNewConversation,
  addMessage,
  deactivateConversation,
  isConversationExpired,
} from '../../domain/entities/Conversation';
import { log } from '../../utils/logger';

export interface SendAIMessageInput {
  user: User;
  telegramId: number;
  message: string;
  conversationTimeoutHours: number;
}

export interface SendAIMessageOutput {
  response: string;
  user: User;
  conversation: Conversation;
}

export class SendAIMessageUseCase {
  constructor(
    private conversationRepo: ConversationRepository,
    private aiProvider: AIProvider,
    private limitService: LimitService
  ) {}

  async execute(input: SendAIMessageInput): Promise<SendAIMessageOutput> {
    const { user, telegramId, message, conversationTimeoutHours } = input;

    // Get or create conversation
    let conversation = await this.conversationRepo.findActiveByTelegramId(telegramId);

    if (conversation && isConversationExpired(conversation, conversationTimeoutHours)) {
      // Deactivate expired conversation
      const deactivated = deactivateConversation(conversation);
      await this.conversationRepo.update(deactivated);
      conversation = null;
      log('info', 'Conversation expired and deactivated', { telegramId });
    }

    if (!conversation) {
      // Create new conversation
      const newConversation = createNewConversation(telegramId);
      conversation = await this.conversationRepo.create(newConversation);
      log('info', 'New conversation created', { telegramId });
    }

    // Add user message
    conversation = addMessage(conversation, 'user', message);

    // Send to AI
    log('debug', 'Sending message to AI', { telegramId, messageLength: message.length });
    const aiResponse = await this.aiProvider.chat(conversation.messages);

    // Add AI response
    conversation = addMessage(conversation, 'assistant', aiResponse);

    // Save conversation
    await this.conversationRepo.update(conversation);

    // Increment usage
    const updatedUser = await this.limitService.incrementAndSave(user);

    log('info', 'AI message processed', {
      telegramId,
      totalUsed: updatedUser.usage.totalUsed,
    });

    return {
      response: aiResponse,
      user: updatedUser,
      conversation,
    };
  }
}
