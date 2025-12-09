import OpenAI from 'openai';
import type { AIProvider, AIProviderConfig, SingleRequestOptions, ChatOptions, ResponseFormat, AIResponse } from '../../domain/services/AIProvider';
import type { Message } from '../../domain/entities/Conversation';
import { log } from '../../utils/logger';

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
