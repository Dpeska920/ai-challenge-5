import type { User } from '../../domain/entities/User';
import type { Conversation } from '../../domain/entities/Conversation';
import type { ConversationRepository } from '../../domain/repositories/ConversationRepository';
import type { AIProvider, ChatOptions, ResponseFormat, AIResponseMetadata, AITool } from '../../domain/services/AIProvider';
import { LimitService } from '../../domain/services/LimitService';
import type { RagService } from '../../domain/services/RagService';
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
import type { MCPClient } from '../../infrastructure/mcp/MCPClient';
import { config } from '../../config/env';

// Get current date/time formatted in the configured timezone
function getCurrentDateTimeForAI(timezone: string): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('ru-RU', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  return formatter.format(now);
}

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
    private chatDefaults: ChatDefaults,
    private mcpClient: MCPClient | null = null,
    private ragService: RagService | null = null
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
    const userProfile = user.profile;
    const customModel = userSettings?.model ?? null;

    // Build context for system prompt
    const timezone = userProfile?.timezone ?? config.defaultTimezone;
    const location = userProfile?.location ?? null;

    // Build user context parts
    const contextParts: string[] = [];
    contextParts.push(`Текущее время пользователя: ${getCurrentDateTimeForAI(timezone)} (${timezone})`);
    if (location) {
      contextParts.push(`Местоположение пользователя: ${location}`);
    }

    // Search RAG for relevant context (threshold 0.8 means distance < 0.8 is relevant)
    let ragContext: string | null = null;
    if (this.ragService) {
      try {
        const ragResults = await this.ragService.searchContext(message, 3, 0.8);
        ragContext = this.ragService.formatContextForPrompt(ragResults);
        if (ragContext) {
          log('debug', 'RAG context found', {
            telegramId,
            resultsCount: ragResults.length,
          });
        }
      } catch (error) {
        log('warn', 'RAG search failed', {
          telegramId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const userContext = '\n\n' + contextParts.join('\n');
    const baseSystemPrompt = userSettings?.systemPrompt ?? this.chatDefaults.systemPrompt;

    // Add RAG context to system prompt if available
    const ragContextSection = ragContext ? `\n\n${ragContext}` : '';

    const chatOptions: ChatOptions = {
      systemPrompt: baseSystemPrompt + userContext + ragContextSection,
      temperature: userSettings?.temperature ?? this.chatDefaults.temperature,
      maxTokens: userSettings?.maxTokens ?? this.chatDefaults.maxTokens,
      responseFormat: userSettings?.responseFormat ?? this.chatDefaults.responseFormat,
      model: customModel ?? undefined,
    };

    // Select provider: if custom model is set and OpenRouter is available, use it
    const useOpenRouter = customModel !== null && this.openRouterProvider !== null;
    const provider = useOpenRouter ? this.openRouterProvider! : this.defaultProvider;

    // Send to AI (with MCP tools if available)
    log('debug', 'Sending message to AI', {
      telegramId,
      messageLength: message.length,
      provider: useOpenRouter ? 'openrouter' : 'default',
      model: customModel ?? 'default',
      hasMcpClient: this.mcpClient !== null,
    });

    let aiResponse: { content: string; metadata: AIResponseMetadata };

    // Check if we should use MCP tools
    if (this.mcpClient && provider.chatWithTools) {
      aiResponse = await this.executeWithMcpTools(conversation, chatOptions, provider);
    } else {
      aiResponse = await provider.chatWithOptions(conversation.messages, chatOptions);
    }

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

  private async executeWithMcpTools(
    conversation: Conversation,
    chatOptions: ChatOptions,
    provider: AIProvider
  ): Promise<{ content: string; metadata: AIResponseMetadata }> {
    if (!this.mcpClient || !provider.chatWithTools) {
      throw new Error('MCP client or chatWithTools not available');
    }

    // Get tools from MCP server
    const mcpTools = await this.mcpClient.getTools();
    const tools: AITool[] = this.mcpClient.convertToOpenAITools(mcpTools);

    log('debug', 'Fetched MCP tools', { count: tools.length });

    // First request with tools
    let response = await provider.chatWithTools(conversation.messages, {
      ...chatOptions,
      tools,
    });

    let totalInputTokens = response.metadata.inputTokens ?? 0;
    let totalOutputTokens = response.metadata.outputTokens ?? 0;
    let totalResponseTimeMs = response.metadata.responseTimeMs;

    // Handle tool calls (max 5 iterations to prevent infinite loops)
    let iterations = 0;
    const maxIterations = 5;

    while (response.toolCalls && response.toolCalls.length > 0 && iterations < maxIterations) {
      iterations++;
      log('debug', 'Processing tool calls', {
        iteration: iterations,
        toolCallsCount: response.toolCalls.length,
      });

      // Execute each tool call
      const toolResults: { toolCallId: string; result: string }[] = [];

      for (const toolCall of response.toolCalls) {
        try {
          const args = JSON.parse(toolCall.function.arguments);

          // Auto-inject telegramId for scheduler tools (override whatever AI generated)
          if (toolCall.function.name.startsWith('scheduler__')) {
            args.telegramId = conversation.telegramId;
          }

          const result = await this.mcpClient.executeTool(toolCall.function.name, args);
          toolResults.push({
            toolCallId: toolCall.id,
            result: typeof result === 'string' ? result : JSON.stringify(result),
          });
          log('debug', 'Tool executed successfully', {
            tool: toolCall.function.name,
            result,
          });
        } catch (error) {
          toolResults.push({
            toolCallId: toolCall.id,
            result: `Error: ${error instanceof Error ? error.message : String(error)}`,
          });
          log('error', 'Tool execution failed', {
            tool: toolCall.function.name,
            error: String(error),
          });
        }
      }

      // Build messages with tool results (using any[] because Message type doesn't support tool role)
      const messagesWithToolResults: unknown[] = [
        ...conversation.messages,
        {
          role: 'assistant' as const,
          content: response.content || '',
          toolCalls: response.toolCalls,
          createdAt: new Date(),
        },
        ...toolResults.map(tr => ({
          role: 'tool' as const,
          content: tr.result,
          toolCallId: tr.toolCallId,
          createdAt: new Date(),
        })),
      ];

      // Continue conversation with tool results
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      response = await provider.chatWithTools(messagesWithToolResults as any, {
        ...chatOptions,
        tools,
      });

      totalInputTokens += response.metadata.inputTokens ?? 0;
      totalOutputTokens += response.metadata.outputTokens ?? 0;
      totalResponseTimeMs += response.metadata.responseTimeMs;
    }

    if (iterations >= maxIterations) {
      log('warn', 'Max tool call iterations reached');
    }

    return {
      content: response.content || 'No response from AI',
      metadata: {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        responseTimeMs: totalResponseTimeMs,
      },
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
