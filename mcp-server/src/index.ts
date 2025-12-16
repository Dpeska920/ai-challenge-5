import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MongoClient, Db, Filter, Document } from 'mongodb';
import { randomUUID } from 'crypto';
import { z } from 'zod';

// MongoDB connection
let db: Db | null = null;

async function connectToDatabase(): Promise<Db> {
  if (db) return db;

  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/telegram-ai-bot';
  console.log('[MCP] Connecting to MongoDB...');

  const client = new MongoClient(uri);
  await client.connect();
  db = client.db();

  console.log('[MCP] Connected to MongoDB');
  return db;
}

// Tool implementations
interface UsersCountParams {
  activated?: boolean;
  registeredAfter?: string;
  registeredBefore?: string;
}

async function getUsersCount(params: UsersCountParams): Promise<number> {
  const database = await connectToDatabase();
  const filter: Filter<Document> = {};

  if (params.activated !== undefined) {
    filter.isActivated = params.activated;
  }

  if (params.registeredAfter || params.registeredBefore) {
    filter.createdAt = {};
    if (params.registeredAfter) {
      filter.createdAt.$gte = new Date(params.registeredAfter);
    }
    if (params.registeredBefore) {
      filter.createdAt.$lte = new Date(params.registeredBefore);
    }
  }

  return database.collection('users').countDocuments(filter);
}

interface RequestsCountParams {
  from?: string;
  to?: string;
}

async function getRequestsCount(params: RequestsCountParams): Promise<number> {
  const database = await connectToDatabase();

  // If no date filters - return all-time total
  if (!params.from && !params.to) {
    const result = await database.collection('users').aggregate([
      { $group: { _id: null, total: { $sum: '$usage.totalUsed' } } },
    ]).toArray();
    return result[0]?.total ?? 0;
  }

  // With date filters - count messages in conversations within period
  const filter: Filter<Document> = {};

  if (params.from || params.to) {
    filter.createdAt = {};
    if (params.from) {
      filter.createdAt.$gte = new Date(params.from);
    }
    if (params.to) {
      filter.createdAt.$lte = new Date(params.to);
    }
  }

  const result = await database.collection('conversations').aggregate([
    { $match: filter },
    { $project: { messageCount: { $size: { $ifNull: ['$messages', []] } } } },
    { $group: { _id: null, total: { $sum: '$messageCount' } } },
  ]).toArray();

  return result[0]?.total ?? 0;
}

interface ConversationsCountParams {
  active?: boolean;
  createdAfter?: string;
  createdBefore?: string;
}

async function getConversationsCount(params: ConversationsCountParams): Promise<number> {
  const database = await connectToDatabase();
  const filter: Filter<Document> = {};

  if (params.active !== undefined) {
    filter.isActive = params.active;
  }

  if (params.createdAfter || params.createdBefore) {
    filter.createdAt = {};
    if (params.createdAfter) {
      filter.createdAt.$gte = new Date(params.createdAfter);
    }
    if (params.createdBefore) {
      filter.createdAt.$lte = new Date(params.createdBefore);
    }
  }

  return database.collection('conversations').countDocuments(filter);
}

// Create MCP server instance
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'aibot-stats',
    version: '1.0.0',
  });

  // getUsersCount - с фильтрами
  server.registerTool(
    'getUsersCount',
    {
      description: 'Получить количество пользователей бота с опциональными фильтрами',
      inputSchema: {
        activated: z.boolean().optional().describe('Фильтр по статусу активации (true/false)'),
        registeredAfter: z.string().optional().describe('Зарегистрированы после даты (ISO формат, например 2024-01-01)'),
        registeredBefore: z.string().optional().describe('Зарегистрированы до даты (ISO формат)'),
      },
    },
    async (args) => {
      const count = await getUsersCount(args);
      return { content: [{ type: 'text' as const, text: String(count) }] };
    }
  );

  // getRequestsCount - по датам
  server.registerTool(
    'getRequestsCount',
    {
      description: 'Получить количество запросов (сообщений) к боту. Без параметров возвращает общее количество за всё время.',
      inputSchema: {
        from: z.string().optional().describe('Начало периода (ISO формат, например 2024-12-15 или 2024-12-15T10:00:00)'),
        to: z.string().optional().describe('Конец периода (ISO формат)'),
      },
    },
    async (args) => {
      const count = await getRequestsCount(args);
      return { content: [{ type: 'text' as const, text: String(count) }] };
    }
  );

  // getConversationsCount - с фильтрами
  server.registerTool(
    'getConversationsCount',
    {
      description: 'Получить количество диалогов с опциональными фильтрами',
      inputSchema: {
        active: z.boolean().optional().describe('Фильтр по активности диалога (true - активные, false - завершённые)'),
        createdAfter: z.string().optional().describe('Созданы после даты (ISO формат)'),
        createdBefore: z.string().optional().describe('Созданы до даты (ISO формат)'),
      },
    },
    async (args) => {
      const count = await getConversationsCount(args);
      return { content: [{ type: 'text' as const, text: String(count) }] };
    }
  );

  return server;
}

// Session management
const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

// Express app
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

// MCP endpoint - handles POST, GET, DELETE for MCP protocol
app.all('/mcp', async (req: Request, res: Response) => {
  let sessionId = req.headers['mcp-session-id'] as string | undefined;
  let session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    sessionId = randomUUID();
    const server = createMcpServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId!,
      onsessioninitialized: (id) => {
        console.log(`[MCP] Session initialized: ${id}`);
      },
    });

    sessions.set(sessionId, { server, transport });
    await server.connect(transport);
    console.log(`[MCP] New session created: ${sessionId}`);
    session = { server, transport };
  }

  if (req.method === 'POST') {
    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[MCP] Error handling request:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  } else if (req.method === 'GET') {
    try {
      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.error('[MCP] Error handling SSE:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  } else if (req.method === 'DELETE') {
    if (sessionId && sessions.has(sessionId)) {
      await session.transport.close();
      sessions.delete(sessionId);
      console.log(`[MCP] Session closed: ${sessionId}`);
      res.status(200).json({ message: 'Session closed' });
    } else {
      res.status(404).json({ error: 'Session not found' });
    }
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
});

// Start server
async function start() {
  // Pre-connect to MongoDB
  await connectToDatabase();

  const port = Number(process.env.PORT) || 3001;
  app.listen(port, () => {
    console.log(`[MCP] Stats server running on http://localhost:${port}`);
    console.log(`[MCP] MCP endpoint: http://localhost:${port}/mcp`);
  });
}

// Cleanup on shutdown
process.on('SIGINT', async () => {
  console.log('[MCP] Shutting down...');
  for (const [sessionId, session] of sessions) {
    await session.transport.close();
    console.log(`[MCP] Closed session: ${sessionId}`);
  }
  process.exit(0);
});

start().catch((error) => {
  console.error('[MCP] Failed to start:', error);
  process.exit(1);
});
