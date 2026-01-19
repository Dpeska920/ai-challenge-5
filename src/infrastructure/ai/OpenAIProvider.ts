import OpenAI from 'openai';
import type {
  AIProvider,
  AIProviderConfig,
  SingleRequestOptions,
  ChatOptions,
  ResponseFormat,
  AIResponse,
  ChatOptionsWithTools,
  AIResponseWithTools,
  AIToolCall,
} from '../../domain/services/AIProvider';
import type { Message } from '../../domain/entities/Conversation';
import { log } from '../../utils/logger';

// Extended message type for tool calls
interface MessageWithTools {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  createdAt: Date;
  toolCalls?: AIToolCall[];
  toolCallId?: string;
}

export class OpenAIProvider implements AIProvider {
  private client: OpenAI;
  private config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async chat(messages: Message[]): Promise<string> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: this.config.systemPrompt },
      ...messages.map((msg) => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      })),
    ];

    log('debug', 'Sending request to OpenAI', {
      model: this.config.model,
      messageCount: openaiMessages.length,
    });

    const requestParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: this.config.model,
      messages: openaiMessages,
      temperature: this.config.temperature ?? 0.7,
      max_tokens: this.config.maxTokens ?? 2000,
    };

    // Handle response format
    if (this.config.responseFormat) {
      this.applyResponseFormat(requestParams, this.config.responseFormat);
    }

    const response = await this.client.chat.completions.create(requestParams);

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response content from OpenAI');
    }

    log('debug', 'Received response from OpenAI', {
      tokensUsed: response.usage?.total_tokens,
    });

    return content;
  }

  async chatWithOptions(messages: Message[], options: ChatOptions): Promise<AIResponse> {
    const modelToUse = options.model ?? this.config.model;

    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: options.systemPrompt },
      ...messages.map((msg) => ({
        role: msg.role as 'system' | 'user' | 'assistant',
        content: msg.content,
      })),
    ];

    log('debug', 'Sending chat request with options', {
      model: modelToUse,
      messageCount: openaiMessages.length,
    });

    const requestParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: modelToUse,
      messages: openaiMessages,
      temperature: options.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 2000,
    };

    if (options.responseFormat) {
      this.applyResponseFormat(requestParams, options.responseFormat);
    }

    const startTime = performance.now();
    const response = await this.client.chat.completions.create(requestParams);
    const endTime = performance.now();
    const responseTimeMs = endTime - startTime;

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response content from OpenAI');
    }

    log('debug', 'Received chat response from OpenAI', {
      tokensUsed: response.usage?.total_tokens,
      responseTimeMs,
    });

    return {
      content,
      metadata: {
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        responseTimeMs,
      },
    };
  }

  async singleRequest(options: SingleRequestOptions): Promise<string> {
    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: options.systemPrompt },
      { role: 'user', content: options.userMessage },
    ];

    log('debug', 'Sending single request to OpenAI', {
      model: this.config.model,
    });

    const requestParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: this.config.model,
      messages: openaiMessages,
      temperature: options.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 2000,
    };

    // Handle response format
    if (options.responseFormat) {
      this.applyResponseFormat(requestParams, options.responseFormat);
    }

    const response = await this.client.chat.completions.create(requestParams);

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('No response content from OpenAI');
    }

    log('debug', 'Received single request response from OpenAI', {
      tokensUsed: response.usage?.total_tokens,
    });

    return content;
  }

  async chatWithTools(messages: Message[] | MessageWithTools[], options: ChatOptionsWithTools): Promise<AIResponseWithTools> {
    const modelToUse = options.model ?? this.config.model;

    const openaiMessages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: options.systemPrompt },
    ];

    // Process messages, handling tool calls and tool results
    for (const msg of messages) {
      if (msg.role === 'tool' && 'toolCallId' in msg && msg.toolCallId) {
        // Tool result message
        openaiMessages.push({
          role: 'tool',
          content: msg.content,
          tool_call_id: msg.toolCallId,
        });
      } else if (msg.role === 'assistant' && 'toolCalls' in msg && msg.toolCalls) {
        // Assistant message with tool calls
        openaiMessages.push({
          role: 'assistant',
          content: msg.content || null,
          tool_calls: msg.toolCalls.map(tc => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.function.name,
              arguments: tc.function.arguments,
            },
          })),
        });
      } else {
        // Regular message
        openaiMessages.push({
          role: msg.role as 'system' | 'user' | 'assistant',
          content: msg.content,
        });
      }
    }

    log('debug', 'Sending chat request with tools', {
      model: modelToUse,
      messageCount: openaiMessages.length,
      toolsCount: options.tools?.length ?? 0,
    });

    const requestParams: OpenAI.ChatCompletionCreateParamsNonStreaming = {
      model: modelToUse,
      messages: openaiMessages,
      temperature: options.temperature ?? this.config.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? this.config.maxTokens ?? 2000,
    };

    // Add tools if provided
    if (options.tools && options.tools.length > 0) {
      requestParams.tools = options.tools.map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.function.name,
          description: tool.function.description,
          parameters: tool.function.parameters,
        },
      }));
    }

    if (options.responseFormat) {
      this.applyResponseFormat(requestParams, options.responseFormat);
    }

    const startTime = performance.now();
    const response = await this.client.chat.completions.create(requestParams);
    const endTime = performance.now();
    const responseTimeMs = endTime - startTime;

    log('debug', 'Raw AI response', { response: JSON.stringify(response).slice(0, 1000) });

    if (!response.choices || response.choices.length === 0) {
      throw new Error(`Invalid AI response: no choices. Raw: ${JSON.stringify(response).slice(0, 500)}`);
    }

    const message = response.choices[0]?.message;

    // Check for tool calls
    const toolCalls: AIToolCall[] | null = message?.tool_calls?.map(tc => ({
      id: tc.id,
      type: 'function' as const,
      function: {
        name: tc.function.name,
        arguments: tc.function.arguments,
      },
    })) ?? null;

    log('debug', 'Received chat response with tools from OpenAI', {
      tokensUsed: response.usage?.total_tokens,
      responseTimeMs,
      hasToolCalls: toolCalls !== null && toolCalls.length > 0,
      toolCallsCount: toolCalls?.length ?? 0,
    });

    return {
      content: message?.content ?? null,
      toolCalls,
      metadata: {
        inputTokens: response.usage?.prompt_tokens,
        outputTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
        responseTimeMs,
      },
    };
  }

  private applyResponseFormat(
    requestParams: OpenAI.ChatCompletionCreateParamsNonStreaming,
    responseFormat: ResponseFormat
  ): void {
    if (responseFormat === 'json_object') {
      requestParams.response_format = { type: 'json_object' };
    } else if (typeof responseFormat === 'object' && responseFormat.type === 'json_schema') {
      requestParams.response_format = {
        type: 'json_schema',
        json_schema: responseFormat.schema as OpenAI.ResponseFormatJSONSchema['json_schema'],
      };
    }
    // 'text' is the default, no need to set
  }
}
