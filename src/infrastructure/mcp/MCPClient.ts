import { log } from '../../utils/logger';

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string }>;
      required: string[];
    };
  };
}

/**
 * MCP Client using simple HTTP API.
 * Communicates with MCP Hub server via /tools and /execute endpoints.
 */
export class MCPClient {
  constructor(private baseUrl: string) {}

  async getTools(): Promise<MCPTool[]> {
    try {
      const response = await fetch(`${this.baseUrl}/tools`);
      if (!response.ok) {
        throw new Error(`Failed to fetch tools: ${response.status}`);
      }
      const data = await response.json() as { tools: MCPTool[] };
      log('debug', 'MCP tools fetched', { count: data.tools.length });
      return data.tools;
    } catch (error) {
      log('error', 'Failed to fetch MCP tools', { error: String(error) });
      throw error;
    }
  }

  async executeTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    try {
      log('debug', 'Executing MCP tool', { name, args });

      const response = await fetch(`${this.baseUrl}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, arguments: args }),
      });

      if (!response.ok) {
        throw new Error(`Failed to execute tool: ${response.status}`);
      }

      const data = await response.json() as { success: boolean; result?: unknown; error?: string };

      if (!data.success) {
        throw new Error(data.error || 'Unknown error');
      }

      log('debug', 'MCP tool executed', { name, result: data.result });
      return data.result;
    } catch (error) {
      log('error', 'Failed to execute MCP tool', { name, error: String(error) });
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch {
      return false;
    }
  }

  // Convert MCP tools to OpenAI tool format
  convertToOpenAITools(tools: MCPTool[]): OpenAITool[] {
    return tools.map(tool => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
  }
}
