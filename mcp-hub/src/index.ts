import express, { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { randomUUID } from 'crypto';
import { z } from 'zod';

interface StdioServerConfig {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface ConnectedStdioServer {
  name: string;
  client: Client;
  transport: StdioClientTransport;
}

interface AggregatedTool {
  name: string;
  fullName: string;
  serverName: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

// Parse MCP_STDIO_SERVERS env: name:command:arg1:arg2,name2:command2
function parseStdioServersConfig(envValue: string | undefined): StdioServerConfig[] {
  if (!envValue) return [];

  const configs: StdioServerConfig[] = [];

  for (const entry of envValue.split(',')) {
    const parts = entry.trim().split(':');
    if (parts.length < 2) continue;

    const name = parts[0];
    const command = parts[1];
    const args = parts.slice(2);

    configs.push({ name, command, args });
  }

  return configs;
}

// Connected stdio servers
const stdioServers = new Map<string, ConnectedStdioServer>();

// Connect to all configured stdio servers
async function connectToStdioServers(configs: StdioServerConfig[]): Promise<void> {
  for (const config of configs) {
    try {
      console.log(`[MCP-Hub] Connecting to ${config.name}...`);

      const client = new Client({
        name: 'mcp-hub',
        version: '1.0.0',
      });

      const transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
      });

      await client.connect(transport);

      stdioServers.set(config.name, {
        name: config.name,
        client,
        transport,
      });

      console.log(`[MCP-Hub] Connected to ${config.name}`);
    } catch (error) {
      console.error(`[MCP-Hub] Failed to connect to ${config.name}:`, error);
    }
  }
}

// Get all tools from all connected servers
async function getAllTools(): Promise<AggregatedTool[]> {
  const allTools: AggregatedTool[] = [];

  for (const [serverName, server] of stdioServers) {
    try {
      const result = await server.client.listTools();

      for (const tool of result.tools) {
        allTools.push({
          name: tool.name,
          fullName: `${serverName}__${tool.name}`,
          serverName,
          description: tool.description || '',
          inputSchema: (tool.inputSchema as Record<string, unknown>) || {
            type: 'object',
            properties: {},
          },
        });
      }
    } catch (error) {
      console.error(`[MCP-Hub] Failed to list tools from ${serverName}:`, error);
    }
  }

  return allTools;
}

// Execute tool on remote server
async function executeTool(
  fullName: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: string; text?: string }> }> {
  const [serverName, ...toolNameParts] = fullName.split('__');
  const toolName = toolNameParts.join('__');

  if (!serverName || !toolName) {
    throw new Error(`Invalid tool name format: ${fullName}`);
  }

  const server = stdioServers.get(serverName);
  if (!server) {
    throw new Error(`Server not found: ${serverName}`);
  }

  console.log(`[MCP-Hub] Executing ${toolName} on ${serverName}`);

  const result = await server.client.callTool({
    name: toolName,
    arguments: args,
  });

  return {
    content: result.content as Array<{ type: string; text?: string }>,
  };
}

// Convert JSON Schema to Zod shape (simplified - handles common cases)
function jsonSchemaToZodShape(schema: Record<string, unknown>): Record<string, z.ZodTypeAny> {
  const properties = (schema.properties as Record<string, { type?: string; description?: string }>) || {};
  const required = (schema.required as string[]) || [];

  const shape: Record<string, z.ZodTypeAny> = {};

  for (const [key, prop] of Object.entries(properties)) {
    let zodType: z.ZodTypeAny;

    switch (prop.type) {
      case 'string':
        zodType = z.string();
        break;
      case 'number':
        zodType = z.number();
        break;
      case 'boolean':
        zodType = z.boolean();
        break;
      case 'array':
        zodType = z.array(z.unknown());
        break;
      default:
        zodType = z.unknown();
    }

    if (prop.description) {
      zodType = zodType.describe(prop.description);
    }

    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    shape[key] = zodType;
  }

  return shape;
}

// Create MCP server that proxies to stdio servers
function createMcpServer(tools: AggregatedTool[]): McpServer {
  const server = new McpServer({
    name: 'mcp-hub',
    version: '1.0.0',
  });

  // Register hub status tool
  server.registerTool(
    'hub__status',
    { description: '[hub] Get connection status of all MCP servers' },
    async () => {
      const status = Array.from(stdioServers.entries()).map(([n]) => ({
        name: n,
        connected: true,
      }));
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(status, null, 2) }],
      };
    }
  );

  // Register proxy tools from stdio servers
  for (const tool of tools) {
    const zodShape = jsonSchemaToZodShape(tool.inputSchema);

    server.registerTool(
      tool.fullName,
      {
        description: `[${tool.serverName}] ${tool.description}`,
        inputSchema: zodShape,
      },
      async (args) => {
        try {
          const result = await executeTool(tool.fullName, args as Record<string, unknown>);
          return result as { content: Array<{ type: 'text'; text: string }> };
        } catch (error) {
          return {
            content: [{
              type: 'text' as const,
              text: `Error: ${error instanceof Error ? error.message : String(error)}`,
            }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}

// Session management
const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

// Cached tools (fetched once at startup)
let cachedTools: AggregatedTool[] = [];

// Express app
const app = express();
app.use(express.json());

// Health check
app.get('/health', (_req: Request, res: Response) => {
  const status = Array.from(stdioServers.entries()).map(([name]) => ({
    name,
    connected: true,
  }));
  res.json({ status: 'ok', servers: status, tools: cachedTools.length });
});

// MCP endpoint
app.all('/mcp', async (req: Request, res: Response) => {
  let sessionId = req.headers['mcp-session-id'] as string | undefined;
  let session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    sessionId = randomUUID();
    const server = createMcpServer(cachedTools);

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId!,
      onsessioninitialized: (id) => {
        console.log(`[MCP-Hub] Session initialized: ${id}`);
      },
    });

    sessions.set(sessionId, { server, transport });
    await server.connect(transport);
    console.log(`[MCP-Hub] New session created: ${sessionId}`);
    session = { server, transport };
  }

  if (req.method === 'POST') {
    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error('[MCP-Hub] Error handling request:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  } else if (req.method === 'GET') {
    try {
      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.error('[MCP-Hub] Error handling SSE:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Internal server error' });
      }
    }
  } else if (req.method === 'DELETE') {
    if (sessionId && sessions.has(sessionId)) {
      await session.transport.close();
      sessions.delete(sessionId);
      console.log(`[MCP-Hub] Session closed: ${sessionId}`);
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
  const configs = parseStdioServersConfig(process.env.MCP_STDIO_SERVERS);

  if (configs.length > 0) {
    console.log(`[MCP-Hub] Connecting to ${configs.length} stdio server(s)...`);
    await connectToStdioServers(configs);

    // Cache tools
    cachedTools = await getAllTools();
    console.log(`[MCP-Hub] Cached ${cachedTools.length} tool(s)`);
  } else {
    console.log('[MCP-Hub] No stdio servers configured');
  }

  const port = Number(process.env.PORT) || 3002;
  app.listen(port, () => {
    console.log(`[MCP-Hub] Server running on http://localhost:${port}`);
    console.log(`[MCP-Hub] MCP endpoint: http://localhost:${port}/mcp`);
  });
}

// Cleanup on shutdown
process.on('SIGINT', async () => {
  console.log('[MCP-Hub] Shutting down...');

  // Close stdio connections
  for (const [name, server] of stdioServers) {
    try {
      await server.transport.close();
      console.log(`[MCP-Hub] Disconnected from ${name}`);
    } catch (error) {
      console.error(`[MCP-Hub] Error disconnecting from ${name}:`, error);
    }
  }

  // Close HTTP sessions
  for (const [sessionId, session] of sessions) {
    await session.transport.close();
    console.log(`[MCP-Hub] Closed session: ${sessionId}`);
  }

  process.exit(0);
});

start().catch((error) => {
  console.error('[MCP-Hub] Failed to start:', error);
  process.exit(1);
});
