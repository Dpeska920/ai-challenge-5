import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MongoClient, Db } from 'mongodb';
import { randomUUID } from 'crypto';

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
async function getUsersCount(): Promise<number> {
  const database = await connectToDatabase();
  return database.collection('users').countDocuments();
}

async function getActivatedUsersCount(): Promise<number> {
  const database = await connectToDatabase();
  return database.collection('users').countDocuments({ isActivated: true });
}

async function getTotalRequests(): Promise<number> {
  const database = await connectToDatabase();
  const result = await database.collection('users').aggregate([
    { $group: { _id: null, total: { $sum: '$usage.totalUsed' } } },
  ]).toArray();
  return result[0]?.total ?? 0;
}

async function getTodayRequests(): Promise<number> {
  const database = await connectToDatabase();
  const result = await database.collection('users').aggregate([
    { $group: { _id: null, total: { $sum: '$usage.dailyUsed' } } },
  ]).toArray();
  return result[0]?.total ?? 0;
}

async function getActiveConversationsCount(): Promise<number> {
  const database = await connectToDatabase();
  return database.collection('conversations').countDocuments({ isActive: true });
}

// Create MCP server instance
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'aibot-stats',
    version: '1.0.0',
  });

  // Register tools using new API
  server.registerTool(
    'getUsersCount',
    { description: 'Получить общее количество пользователей бота' },
    async () => {
      const count = await getUsersCount();
      return { content: [{ type: 'text' as const, text: String(count) }] };
    }
  );

  server.registerTool(
    'getActivatedUsersCount',
    { description: 'Получить количество активированных пользователей бота' },
    async () => {
      const count = await getActivatedUsersCount();
      return { content: [{ type: 'text' as const, text: String(count) }] };
    }
  );

  server.registerTool(
    'getTotalRequests',
    { description: 'Получить общее количество запросов к AI боту (сумма всех использований)' },
    async () => {
      const count = await getTotalRequests();
      return { content: [{ type: 'text' as const, text: String(count) }] };
    }
  );

  server.registerTool(
    'getTodayRequests',
    { description: 'Получить количество запросов к боту за сегодня' },
    async () => {
      const count = await getTodayRequests();
      return { content: [{ type: 'text' as const, text: String(count) }] };
    }
  );

  server.registerTool(
    'getActiveConversationsCount',
    { description: 'Получить количество активных диалогов' },
    async () => {
      const count = await getActiveConversationsCount();
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
