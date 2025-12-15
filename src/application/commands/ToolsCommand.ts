import type { Command, CommandContext } from './CommandHandler';
import type { MCPClient, MCPTool } from '../../infrastructure/mcp/MCPClient';

interface ParsedTool {
  serverName: string;
  toolName: string;
  description: string;
}

export class ToolsCommand implements Command {
  name = 'tools';
  description = 'Show available MCP tools';

  constructor(private mcpClient: MCPClient | null) {}

  async execute(ctx: CommandContext): Promise<void> {
    if (!this.mcpClient) {
      await ctx.sendMessage('MCP сервер не настроен.');
      return;
    }

    try {
      const tools = await this.mcpClient.getTools();

      if (tools.length === 0) {
        await ctx.sendMessage('Нет доступных инструментов.');
        return;
      }

      // Parse and group tools by server
      const parsedTools = tools.map(tool => this.parseTool(tool));
      const groupedTools = this.groupByServer(parsedTools);

      // Build message
      const sections: string[] = [];

      for (const [serverName, serverTools] of groupedTools) {
        const toolsList = serverTools
          .map((tool, index) => `  ${index + 1}. <b>${this.escapeHtml(tool.toolName)}</b>\n      ${this.escapeHtml(tool.description)}`)
          .join('\n');

        sections.push(`<b>[${serverName}]</b>\n${toolsList}`);
      }

      const message = `<b>Доступные инструменты:</b>\n\n${sections.join('\n\n')}`;
      await ctx.sendMessage(message, { parseMode: 'HTML' });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await ctx.sendMessage(`Ошибка получения инструментов: ${errorMessage}`);
    }
  }

  private parseTool(tool: MCPTool): ParsedTool {
    // Tool name format: serverName__toolName
    const [serverName, ...toolNameParts] = tool.name.split('__');
    const toolName = toolNameParts.join('__') || serverName;

    // Remove [serverName] prefix from description if present
    let description = tool.description;
    const prefixMatch = description.match(/^\[[\w-]+\]\s*/);
    if (prefixMatch) {
      description = description.slice(prefixMatch[0].length);
    }

    return {
      serverName: toolNameParts.length > 0 ? serverName : 'unknown',
      toolName,
      description,
    };
  }

  private groupByServer(tools: ParsedTool[]): Map<string, ParsedTool[]> {
    const groups = new Map<string, ParsedTool[]>();

    for (const tool of tools) {
      const existing = groups.get(tool.serverName) || [];
      existing.push(tool);
      groups.set(tool.serverName, existing);
    }

    return groups;
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
