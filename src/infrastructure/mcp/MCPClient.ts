import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { log } from '../../utils/logger.js';

export interface MCPServerConfig {
  name: string;
  url: string;
}

export interface MCPTool {
  name: string;
  fullName: string; // serverName__toolName
  serverName: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
    };
  };
}

interface ConnectedServer {
  name: string;
  client: Client;
  transport: StreamableHTTPClientTransport;
}

/**
 * MCP Client using official MCP SDK with HTTP transport.
 * Supports multiple MCP servers.
 */
export class MCPClient {
  private servers: Map<string, ConnectedServer> = new Map();
  private configs: MCPServerConfig[];

  constructor(configs: MCPServerConfig[]) {
    this.configs = configs;
  }

  /**
   * Connect to all configured MCP servers
   */
  async connect(): Promise<void> {
    for (const config of this.configs) {
      try {
        await this.connectToServer(config);
      } catch (error) {
        log('error', `Failed to connect to MCP server: ${config.name}`, {
          url: config.url,
          error: String(error),
        });
      }
    }
  }

  private async connectToServer(config: MCPServerConfig): Promise<void> {
    log('info', `Connecting to MCP server: ${config.name}`, { url: config.url });

    const client = new Client({
      name: 'aibot-client',
      version: '1.0.0',
    });

    const mcpEndpoint = new URL('/mcp', config.url);
    const transport = new StreamableHTTPClientTransport(mcpEndpoint);

    await client.connect(transport);

    this.servers.set(config.name, {
      name: config.name,
      client,
      transport,
    });

    log('info', `Connected to MCP server: ${config.name}`);
  }

  /**
   * Get tools from all connected servers
   */
  async getTools(): Promise<MCPTool[]> {
    const allTools: MCPTool[] = [];

    for (const [serverName, server] of this.servers) {
      try {
        const result = await server.client.listTools();

        for (const tool of result.tools) {
          allTools.push({
            name: tool.name,
            fullName: `${serverName}__${tool.name}`,
            serverName,
            description: tool.description || '',
            inputSchema: (tool.inputSchema as MCPTool['inputSchema']) || {
              type: 'object',
              properties: {},
            },
          });
        }

        log('debug', `Listed tools from ${serverName}`, { count: result.tools.length });
      } catch (error) {
        log('error', `Failed to list tools from ${serverName}`, { error: String(error) });
      }
    }

    return allTools;
  }

  /**
   * Execute a tool by full name (serverName__toolName)
   */
  async executeTool(fullName: string, args: Record<string, unknown> = {}): Promise<string> {
    const [serverName, ...toolNameParts] = fullName.split('__');
    const toolName = toolNameParts.join('__');

    if (!serverName || !toolName) {
      throw new Error(`Invalid tool name format: ${fullName}. Expected: serverName__toolName`);
    }

    const server = this.servers.get(serverName);
    if (!server) {
      throw new Error(`MCP server not found: ${serverName}`);
    }

    log('debug', `Executing MCP tool: ${fullName}`, { args });

    try {
      const result = await server.client.callTool({
        name: toolName,
        arguments: args,
      });

      // Extract text content from result
      const content = result.content as Array<{ type: string; text?: string }>;
      const textContent = content.find((c) => c.type === 'text');
      const resultText = textContent?.text ?? 'null';

      log('debug', `MCP tool executed: ${fullName}`, { result: resultText });
      return resultText;
    } catch (error) {
      log('error', `Failed to execute MCP tool: ${fullName}`, { error: String(error) });
      throw error;
    }
  }

  /**
   * Health check - verify at least one server is connected
   */
  async healthCheck(): Promise<boolean> {
    if (this.servers.size === 0) {
      return false;
    }

    for (const [, server] of this.servers) {
      try {
        await server.client.listTools();
        return true;
      } catch {
        continue;
      }
    }

    return false;
  }

  /**
   * Get connection status for all servers
   */
  getStatus(): { name: string; connected: boolean }[] {
    return this.configs.map((config) => ({
      name: config.name,
      connected: this.servers.has(config.name),
    }));
  }

  /**
   * Convert MCP tools to OpenAI tool format
   */
  convertToOpenAITools(tools: MCPTool[]): OpenAITool[] {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.fullName,
        description: `[${tool.serverName}] ${tool.description}`,
        parameters: tool.inputSchema,
      },
    }));
  }

  /**
   * Disconnect from all servers
   */
  async disconnect(): Promise<void> {
    for (const [name, server] of this.servers) {
      try {
        await server.transport.close();
        log('info', `Disconnected from MCP server: ${name}`);
      } catch (error) {
        log('error', `Error disconnecting from ${name}`, { error: String(error) });
      }
    }
    this.servers.clear();
  }
}
