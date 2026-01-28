# Telegram AI Bot

AI assistant for Telegram with voice input, GitHub integration, task scheduler, and MCP tools.

Built with Clean Architecture on Bun + TypeScript + MongoDB.

## Features

### AI Chat
- Chat with AI via OpenAI-compatible APIs
- Multi-model support via OpenRouter
- Conversation context with automatic timeout
- Personalization (name, location, user info)
- RAG — search through uploaded documents

### Voice Input
- Send a voice message — bot transcribes and responds
- Local transcription via Sherpa-ONNX (no cloud data transfer)
- Russian and English language support

### GitHub Integration
- View issues and pull requests
- Code review with AI analysis
- Create and manage issues
- Work with multiple repositories

### MCP Tools (AI can use tools)
- **Scheduler** — create reminders and delayed messages
- **Weather** — current weather and forecast
- **Docker** — container monitoring
- **RAG** — knowledge base search
- **GitHub** — repository operations
- **Statistics** — bot usage analytics

### Access Control
- Activation by code
- Message limits (daily, monthly, total)
- Personal settings for each user

## Quick Start

### Docker Compose (recommended)

1. Clone the repository:
```bash
git clone <repo-url>
cd ai-server
```

2. Create `.env` from example:
```bash
cp .env.example .env
```

3. Configure required variables in `.env`:
```env
TELEGRAM_BOT_TOKEN=your_token
ACTIVATION_CODE=secret_phrase
OPENAI_API_KEY=your_key
```

4. (Optional) Download models for voice input:
```bash
mkdir -p stt-models
# Download Sherpa-ONNX models to stt-models/
# Required files: encoder.int8.onnx, decoder.int8.onnx, joiner.int8.onnx, tokens.txt
```

5. Run:
```bash
docker compose up -d
```

### Local Development

```bash
bun install
bun run dev
```

## Bot Commands

### Basic
| Command | Description |
|---------|-------------|
| `/help` | List of commands |
| `/status` | Status and limits |
| `/clear` | Clear conversation history |

### AI Settings
| Command | Description |
|---------|-------------|
| `/model [name]` | Switch model (via OpenRouter) |
| `/temperature [0-2]` | Adjust "creativity" |
| `/maxtokens [num]` | Max response length |
| `/systemprompt [text]` | Custom system prompt |
| `/compact` | Compress history to save tokens |

### Personalization
| Command | Description |
|---------|-------------|
| `/setname [name]` | Set name |
| `/setlocation [city]` | Set location |
| `/settimezone [tz]` | Set timezone |
| `/setpersonalization [text]` | Info about yourself for AI |
| `/profile` | Show profile |

### GitHub
| Command | Description |
|---------|-------------|
| `/github owner/repo` | Set active repository |
| `/issues` | Issues help |
| `/review <PR>` | PR review help |

### RAG (Knowledge Base)
| Command | Description |
|---------|-------------|
| `/rag status` | Index status |
| `/rag reindex` | Reindex documents |
| `/rerank [off\|cross\|colbert]` | Reranking mode |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Telegram Bot                            │
│                         (bot)                                │
└─────────────────────────┬───────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
        ▼                 ▼                 ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│   ML Service  │ │  MCP Servers  │ │    MongoDB    │
│  (voice STT)  │ │    (tools)    │ │    (data)     │
└───────────────┘ └───────┬───────┘ └───────────────┘
                          │
    ┌─────────┬─────────┬─┴───────┬─────────┬─────────┐
    ▼         ▼         ▼         ▼         ▼         ▼
┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐
│ Stats │ │Schedu-│ │Weather│ │Docker │ │  RAG  │ │GitHub │
│  MCP  │ │  ler  │ │  MCP  │ │  MCP  │ │  MCP  │ │  MCP  │
└───────┘ └───────┘ └───────┘ └───────┘ └───────┘ └───────┘
```

### Docker Compose Services

| Service | Port | Description |
|---------|------|-------------|
| bot | 3000 | Telegram bot + Internal API |
| mongo | 27099 | MongoDB |
| mcp | 3001 | Statistics MCP |
| mcp-hub | 3002 | Hub for stdio MCP servers |
| scheduler | 3003 | Task scheduler |
| weather-mcp | 3004 | Weather (OpenWeather API) |
| docker-mcp | 3005 | Docker monitoring |
| rag-mcp | 3007 | RAG document search |
| github-mcp | 3008 | GitHub integration |
| ml-service | 3010 | Voice transcription |

## Configuration

### Core Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | Required |
| `ACTIVATION_CODE` | Activation code | Required |
| `MONGODB_URI` | MongoDB URI | `mongodb://localhost:27017/telegram-ai-bot` |

### AI Provider

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENAI_API_KEY` | API key | Required |
| `OPENAI_BASE_URL` | Base URL | `https://api.openai.com/v1` |
| `OPENAI_MODEL` | Model | `gpt-4o-mini` |
| `OPENAI_TEMPERATURE` | Temperature | `0.7` |
| `OPENAI_MAX_TOKENS` | Max tokens | `2000` |
| `SYSTEM_PROMPT` | System prompt | `You are a helpful assistant.` |

### OpenRouter (Multi-model)

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `OPENROUTER_BASE_URL` | Base URL (optional) |

### Limits

| Variable | Description | Default |
|----------|-------------|---------|
| `DEFAULT_DAILY_LIMIT` | Daily limit | Unlimited |
| `DEFAULT_MONTHLY_LIMIT` | Monthly limit | Unlimited |
| `DEFAULT_TOTAL_LIMIT` | Total limit | `50` |
| `CONVERSATION_TIMEOUT_HOURS` | Conversation timeout | `24` |

### Integrations

| Variable | Description |
|----------|-------------|
| `OPENWEATHER_API_KEY` | OpenWeather API key |
| `GITHUB_TOKEN` | GitHub Personal Access Token |
| `GITHUB_REPOS` | Allowed repositories (`owner/repo1,owner/repo2`) |

### Security

| Variable | Description | Default |
|----------|-------------|---------|
| `IS_SECURE_ENV` | Disable dangerous Docker operations | `false` |
| `DISABLE_TOOLS` | Disable AI tools | `false` |

## Voice Input

Voice input requires Sherpa-ONNX models.

### Downloading Models

1. Download a model (e.g., Parakeet):
```bash
wget https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2.tar.bz2
tar xjf sherpa-onnx-nemo-parakeet-tdt-0.6b-v2.tar.bz2
```

2. Copy files to `stt-models/`:
```
stt-models/
├── encoder.int8.onnx
├── decoder.int8.onnx
├── joiner.int8.onnx
└── tokens.txt
```

3. Restart ml-service:
```bash
docker compose restart ml-service
```

## GitHub Integration

### Setup

1. Create a Personal Access Token on GitHub with permissions:
   - `repo` (for private repositories)
   - `read:org` (for organizations)

2. Add to `.env`:
```env
GITHUB_TOKEN=ghp_your_token
GITHUB_REPOS=owner/repo1,owner/repo2
```

### Usage

After setup, AI automatically knows about available repositories and can:
- Show open issues
- Analyze pull requests
- Create new issues
- Search code

Example: "Show open issues in ai-challenge"

## Project Structure

```
ai-server/
├── src/                    # Main bot
│   ├── domain/             # Entities, Repositories, Services
│   ├── infrastructure/     # Implementations
│   ├── application/        # UseCases, Commands, Handlers
│   └── config/
├── mcp-server/             # Stats MCP
├── mcp-hub/                # Hub for stdio servers
├── scheduler/              # Scheduler
├── weather-mcp/            # Weather
├── docker-mcp/             # Docker monitoring
├── rag-indexer/            # RAG search
├── github-mcp/             # GitHub integration
├── ml-service/             # Voice transcription (Python)
└── stt-models/             # ONNX models (not in git)
```

## Development

### Adding a Command

```typescript
// src/application/commands/MyCommand.ts
import type { Command, CommandContext } from './CommandHandler';

export class MyCommand implements Command {
  name = 'mycommand';
  description = 'Command description';

  async execute(ctx: CommandContext): Promise<void> {
    await ctx.sendMessage('Hello!');
  }
}
```

### Adding an MCP Tool

Create a new MCP server or add a tool to an existing one.
MCP format: https://modelcontextprotocol.io/

## License

MIT
