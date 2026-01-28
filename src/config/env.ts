function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function getEnvOrDefault(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}

function getEnvAsNumber(key: string, defaultValue: number): number {
  const value = process.env[key];
  if (!value) return defaultValue;
  const parsed = parseFloat(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

function getEnvAsNumberOrNull(key: string): number | null {
  const value = process.env[key];
  if (!value) return null;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
}

export type ResponseFormat = 'text' | 'json_object' | { type: 'json_schema'; schema: object };

function parseResponseFormat(value: string): ResponseFormat {
  if (value === 'text' || value === 'json_object') {
    return value;
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed.type === 'json_schema' && parsed.schema) {
      return parsed as ResponseFormat;
    }
  } catch {
    // Ignore parsing errors
  }
  return 'text';
}

export const config = {
  // Telegram
  telegramBotToken: getEnvOrThrow('TELEGRAM_BOT_TOKEN'),

  // MongoDB
  mongodbUri: getEnvOrDefault('MONGODB_URI', 'mongodb://localhost:27017/telegram-ai-bot'),

  // Activation
  activationCode: getEnvOrThrow('ACTIVATION_CODE'),

  // AI Provider (default)
  aiProvider: getEnvOrDefault('AI_PROVIDER', 'openai'),
  openai: {
    apiKey: getEnvOrDefault('OPENAI_API_KEY', 'not-needed'),
    baseUrl: getEnvOrDefault('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    model: getEnvOrDefault('OPENAI_MODEL', 'gpt-4o-mini'),
    temperature: getEnvAsNumber('OPENAI_TEMPERATURE', 0.7),
    maxTokens: getEnvAsNumber('OPENAI_MAX_TOKENS', 2000),
    responseFormat: parseResponseFormat(getEnvOrDefault('OPENAI_RESPONSE_FORMAT', 'text')),
  },

  // OpenRouter (for dynamic model switching)
  openrouter: {
    apiKey: process.env.OPENROUTER_API_KEY || null,
    baseUrl: getEnvOrDefault('OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1'),
  },

  // System prompt
  systemPrompt: getEnvOrDefault('SYSTEM_PROMPT', 'You are a helpful assistant.'),

  // Default limits
  defaultLimits: {
    daily: getEnvAsNumberOrNull('DEFAULT_DAILY_LIMIT'),
    monthly: getEnvAsNumberOrNull('DEFAULT_MONTHLY_LIMIT'),
    total: getEnvAsNumberOrNull('DEFAULT_TOTAL_LIMIT'),
  },

  // Conversation timeout
  conversationTimeoutHours: getEnvAsNumber('CONVERSATION_TIMEOUT_HOURS', 24),

  // MCP Servers (format: name:url,name2:url2)
  mcpServers: parseMcpServers(process.env.MCP_SERVERS),

  // Internal API port (for scheduler notifications)
  internalApiPort: getEnvAsNumber('INTERNAL_API_PORT', 3000),

  // Default timezone for display
  defaultTimezone: getEnvOrDefault('DEFAULT_TIMEZONE', 'Europe/Moscow'),

  // RAG API URL (rag-mcp service)
  ragApiUrl: process.env.RAG_API_URL || null,

  // RAG threshold for semantic search (lower = stricter, higher = more results)
  // For all-MiniLM-L6-v2: typical L2 distances are 1.0-2.0 for relevant content
  ragThreshold: getEnvAsNumber('RAG_THRESHOLD', 2.0),

  // Debug mode for RAG - shows search results after bot response
  debugRag: process.env.DEBUG_RAG === 'true',

  // Disable AI tools/function calling (for models without tools support)
  disableTools: process.env.DISABLE_TOOLS === 'true',

  // ML Service URL for voice transcription
  mlServiceUrl: process.env.ML_SERVICE_URL || null,

  // GitHub Integration
  github: {
    token: process.env.GITHUB_TOKEN || '',
    repos: (process.env.GITHUB_REPOS || '').split(',').filter(Boolean),
  },
};

function parseMcpServers(value: string | undefined): { name: string; url: string }[] {
  if (!value) return [];

  const servers: { name: string; url: string }[] = [];

  for (const entry of value.split(',')) {
    const [name, ...urlParts] = entry.trim().split(':');
    if (name && urlParts.length > 0) {
      const url = urlParts.join(':'); // Rejoin URL parts (contains :)
      servers.push({ name, url });
    }
  }

  return servers;
}

export type Config = typeof config;
