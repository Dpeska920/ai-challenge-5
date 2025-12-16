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

// Tool calling types
export interface AITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

export interface AIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;  // JSON string
  };
}

export interface AIResponseWithTools {
  content: string | null;
  toolCalls: AIToolCall[] | null;
  metadata: AIResponseMetadata;
}

export interface ChatOptionsWithTools extends ChatOptions {
  tools?: AITool[];
}

export interface AIProvider {
  chat(messages: Message[]): Promise<string>;
  chatWithOptions(messages: Message[], options: ChatOptions): Promise<AIResponse>;
  chatWithTools?(messages: Message[], options: ChatOptionsWithTools): Promise<AIResponseWithTools>;
  singleRequest(options: SingleRequestOptions): Promise<string>;
}
