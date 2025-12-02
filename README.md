# Telegram AI Bot

Telegram bot with AI integration built using Clean Architecture on Bun + TypeScript + MongoDB.

## Features

- AI-powered chat using OpenAI API (or compatible providers)
- User activation system with activation code
- Usage limits (daily, monthly, total)
- Conversation history with automatic timeout
- Extensible command system

## Prerequisites

- [Bun](https://bun.sh/) runtime
- MongoDB instance
- Telegram Bot Token (from [@BotFather](https://t.me/BotFather))
- OpenAI API Key (or compatible API)

## Installation

1. Clone the repository and install dependencies:

```bash
bun install
```

2. Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

3. Edit `.env` with your configuration:

```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
OPENAI_API_KEY=your_openai_api_key
ACTIVATION_CODE=your_secret_activation_code
```

## Running the Bot

Development mode (with hot reload):

```bash
bun run dev
```

Production mode:

```bash
bun run start
```

## Usage

1. Start a chat with your bot on Telegram
2. Send the activation code to activate the bot
3. After activation, you can:
   - Send messages to chat with AI
   - Use `/help` to see available commands
   - Use `/clear` to start a new conversation
   - Use `/status` to check your usage limits

## Available Commands

- `/help` - Show list of available commands
- `/clear` - Clear conversation history and start fresh
- `/status` - Show your current usage and limits

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram Bot API token | Required |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/telegram-ai-bot` |
| `ACTIVATION_CODE` | Code to activate the bot | Required |
| `OPENAI_API_KEY` | OpenAI API key | Required |
| `OPENAI_BASE_URL` | OpenAI API base URL | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | Model to use | `gpt-4o-mini` |
| `OPENAI_TEMPERATURE` | Response randomness (0-2) | `0.7` |
| `OPENAI_MAX_TOKENS` | Maximum response tokens | `2000` |
| `OPENAI_RESPONSE_FORMAT` | Response format (text/json_object) | `text` |
| `SYSTEM_PROMPT` | System prompt for AI | `You are a helpful assistant.` |
| `DEFAULT_DAILY_LIMIT` | Daily message limit (empty = unlimited) | - |
| `DEFAULT_MONTHLY_LIMIT` | Monthly message limit (empty = unlimited) | - |
| `DEFAULT_TOTAL_LIMIT` | Total message limit (empty = unlimited) | `50` |
| `CONVERSATION_TIMEOUT_HOURS` | Hours before conversation expires | `24` |

## Project Structure

```
src/
├── domain/                 # Domain layer (entities, repositories, services)
│   ├── entities/
│   ├── repositories/
│   └── services/
├── infrastructure/         # Infrastructure layer (implementations)
│   ├── database/
│   ├── repositories/
│   ├── ai/
│   └── telegram/
├── application/            # Application layer (use cases, handlers, commands)
│   ├── commands/
│   ├── handlers/
│   └── usecases/
├── config/
├── utils/
└── index.ts
```

## Adding New Commands

1. Create a new command file in `src/application/commands/`:

```typescript
import type { Command, CommandContext } from './CommandHandler';

export class MyCommand implements Command {
  name = 'mycommand';
  description = 'Description of my command';

  async execute(ctx: CommandContext): Promise<void> {
    await ctx.sendMessage('Hello from my command!');
  }
}
```

2. Register it in `src/index.ts`:

```typescript
import { MyCommand } from './application/commands/MyCommand';

// In main():
commandRegistry.register(new MyCommand());
```

## License

MIT
