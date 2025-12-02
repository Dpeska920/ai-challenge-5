import { config } from './config/env';
import { connectToDatabase, disconnectFromDatabase, createIndexes } from './infrastructure/database/mongodb';
import { MongoUserRepository } from './infrastructure/repositories/MongoUserRepository';
import { MongoConversationRepository } from './infrastructure/repositories/MongoConversationRepository';
import { OpenAIProvider } from './infrastructure/ai/OpenAIProvider';
import { LimitService } from './domain/services/LimitService';
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
import { log } from './utils/logger';

async function main(): Promise<void> {
  log('info', 'Starting application...');

  // Connect to database
  await connectToDatabase(config.mongodbUri);
  await createIndexes();

  // Initialize repositories
  const userRepository = new MongoUserRepository();
  const conversationRepository = new MongoConversationRepository();

  // Initialize AI provider
  const aiProvider = new OpenAIProvider({
    apiKey: config.openai.apiKey,
    baseUrl: config.openai.baseUrl,
    model: config.openai.model,
    systemPrompt: config.systemPrompt,
    temperature: config.openai.temperature,
    maxTokens: config.openai.maxTokens,
    responseFormat: config.openai.responseFormat,
  });

  // Initialize services
  const limitService = new LimitService(userRepository);

  // Initialize use cases
  const activateUserUseCase = new ActivateUserUseCase(userRepository);
  const checkLimitsUseCase = new CheckLimitsUseCase(limitService);
  const sendAIMessageUseCase = new SendAIMessageUseCase(
    conversationRepository,
    aiProvider,
    limitService
  );

  // Register commands
  commandRegistry.register(new HelpCommand());
  commandRegistry.register(new ClearCommand(conversationRepository));
  commandRegistry.register(new StatusCommand(limitService));
  commandRegistry.register(new FakeUserCommand(aiProvider, limitService));

  // Initialize message handler
  const messageHandler = new MessageHandler(
    userRepository,
    config,
    activateUserUseCase,
    checkLimitsUseCase,
    sendAIMessageUseCase,
    limitService
  );

  // Initialize and start bot
  const telegramBot = new TelegramBot(config.telegramBotToken, messageHandler);

  // Graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    log('info', `Received ${signal}, shutting down gracefully...`);

    try {
      await telegramBot.stop();
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
