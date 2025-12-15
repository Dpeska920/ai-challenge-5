import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

export interface MCPServerConfig {
  name: string;
  // For HTTP-based MCP servers
  url?: string;
  // For stdio-based MCP servers (local commands)
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface AggregatedTool {
  name: string;           // Original tool name
  fullName: string;       // serverName__toolName (for routing)
  serverName: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

interface RemoteClient {
  name: string;
  client: Client;
  transport: StreamableHTTPClientTransport | StdioClientTransport;
  connected: boolean;
}

export class MCPHub {
  private remoteClients: Map<string, RemoteClient> = new Map();
  private localTools: Map<string, () => Promise<unknown>> = new Map();

  constructor(private configs: MCPServerConfig[]) {}

  // Register a local tool (from our own server)
  registerLocalTool(
    name: string,
    description: string,
    handler: () => Promise<unknown>
  ): void {
    this.localTools.set(name, handler);
    console.log(`[MCPHub] Registered local tool: ${name}`);
  }

  // Connect to all configured remote MCP servers
  async connectAll(): Promise<void> {
    for (const config of this.configs) {
      try {
        await this.connectToServer(config);
      } catch (error) {
        console.error(`[MCPHub] Failed to connect to ${config.name}:`, error);
      }
    }
  }

  private async connectToServer(config: MCPServerConfig): Promise<void> {
    console.log(`[MCPHub] Connecting to ${config.name}...`);

    const client = new Client({
      name: 'mcp-hub',
      version: '1.0.0',
    });

    let transport: StreamableHTTPClientTransport | StdioClientTransport;

    if (config.url) {
      // HTTP-based MCP server
      const mcpEndpoint = new URL('/mcp', config.url);
      transport = new StreamableHTTPClientTransport(mcpEndpoint);
    } else if (config.command) {
      // Stdio-based MCP server (local process)
      transport = new StdioClientTransport({
        command: config.command,
        args: config.args,
        env: config.env,
      });
    } else {
      throw new Error(`Invalid config for ${config.name}: need url or command`);
    }

    await client.connect(transport);

    this.remoteClients.set(config.name, {
      name: config.name,
      client,
      transport,
      connected: true,
    });

    console.log(`[MCPHub] Connected to ${config.name}`);
  }

  // Get all tools from all sources (local + remote)
  async getAllTools(): Promise<AggregatedTool[]> {
    const allTools: AggregatedTool[] = [];

    // Add local tools
    for (const [name] of this.localTools) {
      allTools.push({
        name,
        fullName: `local__${name}`,
        serverName: 'local',
        description: this.getLocalToolDescription(name),
        inputSchema: { type: 'object', properties: {}, required: [] },
      });
    }

    // Add tools from remote servers
    for (const [serverName, remoteClient] of this.remoteClients) {
      if (!remoteClient.connected) continue;

      try {
        const result = await remoteClient.client.listTools();

        for (const tool of result.tools) {
          allTools.push({
            name: tool.name,
            fullName: `${serverName}__${tool.name}`,
            serverName,
            description: tool.description || '',
            inputSchema: (tool.inputSchema as AggregatedTool['inputSchema']) || {
              type: 'object',
              properties: {},
              required: [],
            },
          });
        }
      } catch (error) {
        console.error(`[MCPHub] Failed to list tools from ${serverName}:`, error);
      }
    }

    return allTools;
  }

  // Execute a tool by full name (serverName__toolName)
  async executeTool(fullName: string, args: Record<string, unknown>): Promise<unknown> {
    const [serverName, ...toolNameParts] = fullName.split('__');
    const toolName = toolNameParts.join('__'); // In case tool name contains __

    if (!serverName || !toolName) {
      throw new Error(`Invalid tool name format: ${fullName}. Expected: serverName__toolName`);
    }

    console.log(`[MCPHub] Executing tool ${toolName} on ${serverName}`);

    if (serverName === 'local') {
      // Execute local tool
      const handler = this.localTools.get(toolName);
      if (!handler) {
        throw new Error(`Local tool not found: ${toolName}`);
      }
      return await handler();
    }

    // Execute remote tool
    const remoteClient = this.remoteClients.get(serverName);
    if (!remoteClient) {
      throw new Error(`Server not found: ${serverName}`);
    }

    if (!remoteClient.connected) {
      throw new Error(`Server not connected: ${serverName}`);
    }

    const result = await remoteClient.client.callTool({
      name: toolName,
      arguments: args,
    });

    // Extract text content from result
    const content = result.content as Array<{ type: string; text?: string }>;
    const textContent = content.find((c) => c.type === 'text');
    return textContent?.text ?? null;
  }

  // Disconnect from all servers
  async disconnectAll(): Promise<void> {
    for (const [name, remoteClient] of this.remoteClients) {
      try {
        await remoteClient.transport.close();
        console.log(`[MCPHub] Disconnected from ${name}`);
      } catch (error) {
        console.error(`[MCPHub] Error disconnecting from ${name}:`, error);
      }
    }
    this.remoteClients.clear();
  }

  // Get connection status
  getStatus(): { name: string; connected: boolean }[] {
    const status: { name: string; connected: boolean }[] = [
      { name: 'local', connected: true },
    ];

    for (const [name, client] of this.remoteClients) {
      status.push({ name, connected: client.connected });
    }

    return status;
  }

  private getLocalToolDescription(name: string): string {
    const descriptions: Record<string, string> = {
      getUsersCount: 'Получить общее количество пользователей бота',
      getActivatedUsersCount: 'Получить количество активированных пользователей бота',
      getTotalRequests: 'Получить общее количество запросов к AI боту',
      getTodayRequests: 'Получить количество запросов к боту за сегодня',
      getActiveConversationsCount: 'Получить количество активных диалогов',
    };
    return descriptions[name] || '';
  }
}

// Parse MCP_REMOTE_SERVERS env variable
// Format: name1:url1,name2:url2 or name1:cmd:arg1:arg2
export function parseRemoteServersConfig(envValue: string | undefined): MCPServerConfig[] {
  if (!envValue) return [];

  const configs: MCPServerConfig[] = [];

  for (const entry of envValue.split(',')) {
    const parts = entry.trim().split(':');
    if (parts.length < 2) continue;

    const name = parts[0];

    if (parts[1].startsWith('http')) {
      // HTTP URL (may contain : in port)
      const url = parts.slice(1).join(':');
      configs.push({ name, url });
    } else {
      // Command with args
      const command = parts[1];
      const args = parts.slice(2);
      configs.push({ name, command, args });
    }
  }

  return configs;
}
