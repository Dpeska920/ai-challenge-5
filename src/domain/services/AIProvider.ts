import type { Message } from '../entities/Conversation';

export type ResponseFormat = 'text' | 'json_object' | { type: 'json_schema'; schema: object };

export interface AIResponseMetadata {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  responseTimeMs: number;
}

export interface AIResponse {
  content: string;
  metadata: AIResponseMetadata;
}

export interface AIProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: ResponseFormat;
}

export interface SingleRequestOptions {
  systemPrompt: string;
  userMessage: string;
  responseFormat?: ResponseFormat;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatOptions {
  systemPrompt: string;
  responseFormat?: ResponseFormat;
  temperature?: number;
  maxTokens?: number;
  model?: string;  // Override model for this request
}

export interface AIProvider {
  chat(messages: Message[]): Promise<string>;
  chatWithOptions(messages: Message[], options: ChatOptions): Promise<AIResponse>;
  singleRequest(options: SingleRequestOptions): Promise<string>;
}
