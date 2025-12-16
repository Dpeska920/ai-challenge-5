import { config } from './config/env';
import { connectToDatabase, disconnectFromDatabase, createIndexes } from './infrastructure/database/mongodb';
import { MongoUserRepository } from './infrastructure/repositories/MongoUserRepository';
import { MongoConversationRepository } from './infrastructure/repositories/MongoConversationRepository';
import { MongoCommandHistoryRepository } from './infrastructure/repositories/MongoCommandHistoryRepository';
import { OpenAIProvider } from './infrastructure/ai/OpenAIProvider';
import { MCPClient } from './infrastructure/mcp/MCPClient';
import { LimitService } from './domain/services/LimitService';
import { CommandHistoryService } from './domain/services/CommandHistoryService';
import { GameCreationService } from './domain/services/GameCreationService';
import { ActivateUserUseCase } from './application/usecases/ActivateUser';
import { CheckLimitsUseCase } from './application/usecases/CheckLimits';
import { SendAIMessageUseCase } from './application/usecases/SendAIMessage';
import { MessageHandler } from './application/handlers/MessageHandler';
import { TelegramBot } from './infrastructure/telegram/TelegramBot';
import { commandRegistry } from './application/commands/CommandHandler';
import { HelpCommand } from './application/commands/HelpCommand';
import { ClearCommand } from './application/commands/ClearCommand';
import { StatusCommand } from './application/commands/StatusCommand';
import { FakeUserCommand } from './application/commands/FakeUserCommand';
import { GameCreationCommand } from './application/commands/GameCreationCommand';
import { TemperatureCommand } from './application/commands/TemperatureCommand';
import { SystemPromptCommand } from './application/commands/SystemPromptCommand';
import { MaxTokensCommand } from './application/commands/MaxTokensCommand';
import { ResponseFormatCommand } from './application/commands/ResponseFormatCommand';
import { ModelCommand } from './application/commands/ModelCommand';
import { CompactCommand } from './application/commands/CompactCommand';
import { ToolsCommand } from './application/commands/ToolsCommand';
import { log } from './utils/logger';

async function main(): Promise<void> {
  log('info', 'Starting application...');

  // Connect to database
  await connectToDatabase(config.mongodbUri);
  await createIndexes();

  // Initialize repositories
  const userRepository = new MongoUserRepository();
  const conversationRepository = new MongoConversationRepository();
  const commandHistoryRepository = new MongoCommandHistoryRepository();

  // Initialize default AI provider
  const aiProvider = new OpenAIProvider({
    apiKey: config.openai.apiKey,
    baseUrl: config.openai.baseUrl,
    model: config.openai.model,
    systemPrompt: config.systemPrompt,
    temperature: config.openai.temperature,
    maxTokens: config.openai.maxTokens,
    responseFormat: config.openai.responseFormat,
  });

  // Initialize OpenRouter provider (for dynamic model switching)
  const openRouterProvider = config.openrouter.apiKey
    ? new OpenAIProvider({
        apiKey: config.openrouter.apiKey,
        baseUrl: config.openrouter.baseUrl,
        model: 'openai/gpt-4o-mini', // Default model, will be overridden by user settings
        systemPrompt: config.systemPrompt,
        temperature: config.openai.temperature,
        maxTokens: config.openai.maxTokens,
        responseFormat: config.openai.responseFormat,
      })
    : null;

  if (openRouterProvider) {
    log('info', 'OpenRouter provider initialized');
  } else {
    log('info', 'OpenRouter provider not configured (OPENROUTER_API_KEY not set)');
  }

  // Initialize MCP client (optional)
  const mcpClient = config.mcpServers.length > 0 ? new MCPClient(config.mcpServers) : null;

  if (mcpClient) {
    log('info', 'MCP client initialized', { servers: config.mcpServers.map(s => s.name) });
    // Connect to all MCP servers
    await mcpClient.connect();
    // Check MCP health
    const isHealthy = await mcpClient.healthCheck();
    if (isHealthy) {
      log('info', 'MCP servers connected', { status: mcpClient.getStatus() });
    } else {
      log('warn', 'MCP servers health check failed - tools may not be available');
    }
  } else {
    log('info', 'MCP client not configured (MCP_SERVERS not set)');
  }

  // Initialize services
  const limitService = new LimitService(userRepository);
  const commandHistoryService = new CommandHistoryService(commandHistoryRepository);
  const gameCreationService = new GameCreationService(conversationRepository, aiProvider, limitService);

  // Initialize use cases
  const activateUserUseCase = new ActivateUserUseCase(userRepository);
  const checkLimitsUseCase = new CheckLimitsUseCase(limitService);
  const sendAIMessageUseCase = new SendAIMessageUseCase(
    conversationRepository,
    aiProvider,
    openRouterProvider,
    limitService,
    {
      systemPrompt: config.systemPrompt,
      temperature: config.openai.temperature,
      maxTokens: config.openai.maxTokens,
      responseFormat: config.openai.responseFormat,
    },
    mcpClient
  );

  // Register commands
  commandRegistry.register(new HelpCommand());
  commandRegistry.register(new ClearCommand(conversationRepository));
  commandRegistry.register(new StatusCommand(limitService));
  commandRegistry.register(new FakeUserCommand(aiProvider, limitService, commandHistoryService));
  commandRegistry.register(new GameCreationCommand(conversationRepository, limitService, commandHistoryService));
  commandRegistry.register(new TemperatureCommand(userRepository));
  commandRegistry.register(new SystemPromptCommand(userRepository));
  commandRegistry.register(new MaxTokensCommand(userRepository));
  commandRegistry.register(new ResponseFormatCommand(userRepository));
  commandRegistry.register(new ModelCommand(userRepository, openRouterProvider !== null));
  commandRegistry.register(new CompactCommand(conversationRepository, aiProvider, limitService));
  commandRegistry.register(new ToolsCommand(mcpClient));

  // Initialize message handler
  const messageHandler = new MessageHandler(
    userRepository,
    config,
    activateUserUseCase,
    checkLimitsUseCase,
    sendAIMessageUseCase,
    limitService,
    gameCreationService,
    conversationRepository
  );

  // Initialize and start bot
  const telegramBot = new TelegramBot(config.telegramBotToken, messageHandler);

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    log('info', `Received ${signal}, shutting down gracefully...`);

    try {
      await telegramBot.stop();
      if (mcpClient) {
        await mcpClient.disconnect();
      }
      await disconnectFromDatabase();
      log('info', 'Shutdown complete');
      process.exit(0);
    } catch (error) {
      log('error', 'Error during shutdown', {
        error: error instanceof Error ? error.message : String(error),
      });
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // Start the bot
  await telegramBot.start();
}

main().catch((error) => {
  log('error', 'Fatal error', {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  });
  process.exit(1);
});
