import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MongoClient, Db } from 'mongodb';
import { randomUUID } from 'crypto';
import { MCPHub, parseRemoteServersConfig, type AggregatedTool } from './hub.js';

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

// Local tool implementations
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

// Initialize MCP Hub
const remoteServersConfig = parseRemoteServersConfig(process.env.MCP_REMOTE_SERVERS);
const hub = new MCPHub(remoteServersConfig);

// Register local tools with hub
hub.registerLocalTool('getUsersCount', 'Получить общее количество пользователей бота', getUsersCount);
hub.registerLocalTool('getActivatedUsersCount', 'Получить количество активированных пользователей бота', getActivatedUsersCount);
hub.registerLocalTool('getTotalRequests', 'Получить общее количество запросов к AI боту', getTotalRequests);
hub.registerLocalTool('getTodayRequests', 'Получить количество запросов к боту за сегодня', getTodayRequests);
hub.registerLocalTool('getActiveConversationsCount', 'Получить количество активных диалогов', getActiveConversationsCount);

// Cached remote tools (populated after hub connects)
let cachedRemoteTools: AggregatedTool[] = [];

// Create MCP server instance that uses the hub
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'aibot-mcp-hub',
    version: '1.0.0',
  });

  // Register local tools
  server.tool(
    'local__getUsersCount',
    'Получить общее количество пользователей бота',
    {},
    async () => {
      const count = await getUsersCount();
      return { content: [{ type: 'text', text: String(count) }] };
    }
  );

  server.tool(
    'local__getActivatedUsersCount',
    'Получить количество активированных пользователей бота',
    {},
    async () => {
      const count = await getActivatedUsersCount();
      return { content: [{ type: 'text', text: String(count) }] };
    }
  );

  server.tool(
    'local__getTotalRequests',
    'Получить общее количество запросов к AI боту (сумма всех использований)',
    {},
    async () => {
      const count = await getTotalRequests();
      return { content: [{ type: 'text', text: String(count) }] };
    }
  );

  server.tool(
    'local__getTodayRequests',
    'Получить количество запросов к боту за сегодня',
    {},
    async () => {
      const count = await getTodayRequests();
      return { content: [{ type: 'text', text: String(count) }] };
    }
  );

  server.tool(
    'local__getActiveConversationsCount',
    'Получить количество активных диалогов',
    {},
    async () => {
      const count = await getActiveConversationsCount();
      return { content: [{ type: 'text', text: String(count) }] };
    }
  );

  // Hub status tool
  server.tool(
    'hub__status',
    'Получить статус подключения ко всем MCP серверам',
    {},
    async () => {
      const status = hub.getStatus();
      return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
    }
  );

  // Register proxy tools for all remote servers' tools
  for (const tool of cachedRemoteTools) {
    // Skip local tools (already registered above)
    if (tool.serverName === 'local') continue;

    server.tool(
      tool.fullName,
      `[${tool.serverName}] ${tool.description}`,
      tool.inputSchema.properties,
      async (args: Record<string, unknown>) => {
        try {
          const result = await hub.executeTool(tool.fullName, args);
          return { content: [{ type: 'text', text: String(result ?? 'null') }] };
        } catch (error) {
          return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }] };
        }
      }
    );
  }

  return server;
}

// Session management
const sessions = new Map<string, StreamableHTTPServerTransport>();

// Express app
const app = express();
app.use(express.json());

// Health check endpoint
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', hubStatus: hub.getStatus() });
});

// MCP endpoint - handles POST, GET, DELETE
app.all('/mcp', async (req: Request, res: Response) => {
  let sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport = sessionId ? sessions.get(sessionId) : undefined;

  if (!transport) {
    sessionId = randomUUID();
    const server = createMcpServer();

    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId!,
      onsessioninitialized: (id) => {
        console.log(`[MCP] Session initialized: ${id}`);
      },
    });

    sessions.set(sessionId, transport);
    await server.connect(transport);
    console.log(`[MCP] New session created: ${sessionId}`);
  }

  if (req.method === 'POST') {
    try {
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[MCP] Error handling request:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  } else if (req.method === 'GET') {
    try {
      await transport.handleRequest(req, res);
    } catch (error) {
      console.error('[MCP] Error handling SSE:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  } else if (req.method === 'DELETE') {
    if (sessionId && sessions.has(sessionId)) {
      await transport.close();
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

// Legacy API - aggregated tools from hub
app.get('/tools', async (_req: Request, res: Response) => {
  try {
    const tools = await hub.getAllTools();
    const formattedTools = tools.map(tool => ({
      name: tool.fullName,  // Use full name with prefix for routing
      description: `[${tool.serverName}] ${tool.description}`,
      inputSchema: tool.inputSchema,
    }));
    res.json({ tools: formattedTools });
  } catch (error) {
    console.error('[MCP] Error getting tools:', error);
    res.status(500).json({ error: 'Failed to get tools' });
  }
});

// Legacy API - execute tool via hub
app.post('/execute', async (req: Request, res: Response) => {
  const { name, arguments: args } = req.body;

  try {
    console.log(`[MCP] Executing tool: ${name}`);
    const result = await hub.executeTool(name, args || {});
    console.log(`[MCP] Tool result: ${name} =>`, result);
    res.json({ success: true, result });
  } catch (error) {
    console.error(`[MCP] Error executing tool ${name}:`, error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

// Hub status endpoint
app.get('/hub/status', (_req: Request, res: Response) => {
  res.json({ servers: hub.getStatus() });
});

// Start server
async function start() {
  // Connect to remote MCP servers
  if (remoteServersConfig.length > 0) {
    console.log(`[MCP] Connecting to ${remoteServersConfig.length} remote MCP server(s)...`);
    await hub.connectAll();

    // Cache remote tools for MCP protocol registration
    cachedRemoteTools = await hub.getAllTools();
    const remoteToolsCount = cachedRemoteTools.filter(t => t.serverName !== 'local').length;
    console.log(`[MCP] Cached ${remoteToolsCount} remote tool(s) from ${remoteServersConfig.length} server(s)`);
  } else {
    console.log('[MCP] No remote MCP servers configured');
  }

  const port = Number(process.env.PORT) || 3001;
  app.listen(port, () => {
    console.log(`[MCP] Hub server running on http://localhost:${port}`);
    console.log(`[MCP] MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`[MCP] Legacy API: http://localhost:${port}/tools, http://localhost:${port}/execute`);
    console.log(`[MCP] Hub status: http://localhost:${port}/hub/status`);
  });
}

// Cleanup on shutdown
process.on('SIGINT', async () => {
  console.log('[MCP] Shutting down...');
  await hub.disconnectAll();
  for (const [sessionId, transport] of sessions) {
    await transport.close();
    console.log(`[MCP] Closed session: ${sessionId}`);
  }
  process.exit(0);
});

start().catch((error) => {
  console.error('[MCP] Failed to start:', error);
  process.exit(1);
});
