import type { Message } from '../entities/Conversation';

export type ResponseFormat = 'text' | 'json_object' | { type: 'json_schema'; schema: object };

export interface AIProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model: string;
  systemPrompt: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: ResponseFormat;
}

export interface AIProvider {
  chat(messages: Message[]): Promise<string>;
}
