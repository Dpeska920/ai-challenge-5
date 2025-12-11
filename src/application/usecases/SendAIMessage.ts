import type { User } from '../../domain/entities/User';
import type { Conversation } from '../../domain/entities/Conversation';
import type { ConversationRepository } from '../../domain/repositories/ConversationRepository';
import type { AIProvider, ChatOptions, ResponseFormat, AIResponseMetadata } from '../../domain/services/AIProvider';
import { LimitService } from '../../domain/services/LimitService';
import {
  createNewConversation,
  addMessage,
  deactivateConversation,
  isConversationExpired,
  updateTokens,
  estimateTokens,
} from '../../domain/entities/Conversation';
import { log } from '../../utils/logger';
import { markdownToTelegramHtml } from '../../utils/markdownToHtml';

export interface ChatDefaults {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  responseFormat: ResponseFormat;
}

export interface SendAIMessageInput {
  user: User;
  telegramId: number;
  message: string;
  conversationTimeoutHours: number;
}

export interface SendAIMessageOutput {
  response: string;
  parseMode: 'HTML' | 'MarkdownV2' | undefined;
  user: User;
  conversation: Conversation;
}

export class SendAIMessageUseCase {
  constructor(
    private conversationRepo: ConversationRepository,
    private defaultProvider: AIProvider,
    private openRouterProvider: AIProvider | null,
    private limitService: LimitService,
    private chatDefaults: ChatDefaults
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

    // Build chat options from user settings with fallback to defaults
    const userSettings = user.chatSettings;
    const customModel = userSettings?.model ?? null;

    const chatOptions: ChatOptions = {
      systemPrompt: userSettings?.systemPrompt ?? this.chatDefaults.systemPrompt,
      temperature: userSettings?.temperature ?? this.chatDefaults.temperature,
      maxTokens: userSettings?.maxTokens ?? this.chatDefaults.maxTokens,
      responseFormat: userSettings?.responseFormat ?? this.chatDefaults.responseFormat,
      model: customModel ?? undefined,
    };

    // Select provider: if custom model is set and OpenRouter is available, use it
    const useOpenRouter = customModel !== null && this.openRouterProvider !== null;
    const provider = useOpenRouter ? this.openRouterProvider! : this.defaultProvider;

    // Send to AI
    log('debug', 'Sending message to AI', {
      telegramId,
      messageLength: message.length,
      provider: useOpenRouter ? 'openrouter' : 'default',
      model: customModel ?? 'default',
    });
    const aiResponse = await provider.chatWithOptions(conversation.messages, chatOptions);

    // Add AI response (only content, not metadata)
    conversation = addMessage(conversation, 'assistant', aiResponse.content);

    // Update conversation tokens
    const inputTokens = aiResponse.metadata.inputTokens ?? 0;
    const outputTokens = aiResponse.metadata.outputTokens ?? 0;
    conversation = updateTokens(conversation, inputTokens, outputTokens);

    // Save conversation
    await this.conversationRepo.update(conversation);

    // Increment usage
    const updatedUser = await this.limitService.incrementAndSave(user);

    log('info', 'AI message processed', {
      telegramId,
      totalUsed: updatedUser.usage.totalUsed,
    });

    // Estimate tokens for the last user message
    const lastMessageTokens = estimateTokens(message);

    // Format response with stats
    const responseWithStats = this.formatResponseWithStats(
      aiResponse.content,
      aiResponse.metadata,
      lastMessageTokens,
      conversation.tokens
    );

    // Convert markdown to Telegram HTML
    const htmlResponse = markdownToTelegramHtml(responseWithStats);

    return {
      response: htmlResponse,
      parseMode: 'HTML',
      user: updatedUser,
      conversation,
    };
  }

  private formatResponseWithStats(
    content: string,
    metadata: AIResponseMetadata,
    lastMessageTokens: number,
    conversationTokens: { totalInputTokens: number; totalOutputTokens: number }
  ): string {
    const stats: string[] = [];

    // Input tokens: total packet / last message (e.g., "In: 302/+57")
    if (metadata.inputTokens !== undefined) {
      stats.push(`In: ${metadata.inputTokens}/+${lastMessageTokens}`);
    }

    // Output tokens
    if (metadata.outputTokens !== undefined) {
      stats.push(`Out: ${metadata.outputTokens}`);
    }

    // Total conversation tokens
    const totalConversation = conversationTokens.totalInputTokens + conversationTokens.totalOutputTokens;
    stats.push(`Σ: ${totalConversation}`);

    // Response time
    const timeSeconds = (metadata.responseTimeMs / 1000).toFixed(2);
    stats.push(`${timeSeconds}s`);

    // Speed (tokens per second)
    if (metadata.outputTokens !== undefined && metadata.responseTimeMs > 0) {
      const tokensPerSecond = (metadata.outputTokens / (metadata.responseTimeMs / 1000)).toFixed(1);
      stats.push(`${tokensPerSecond} t/s`);
    }

    return `${content}\n\n---\n${stats.join(' | ')}`;
  }
}
