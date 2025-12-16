import type { Command, CommandContext } from './CommandHandler';
import type { MCPClient, MCPTool } from '../../infrastructure/mcp/MCPClient';

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

      // Group tools by server
      const groupedTools = this.groupByServer(tools);

      // Build message
      const sections: string[] = [];

      for (const [serverName, serverTools] of groupedTools) {
        const toolsList = serverTools
          .map((tool, index) => `  ${index + 1}. <b>${this.escapeHtml(tool.name)}</b>\n      ${this.escapeHtml(tool.description)}`)
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

  private groupByServer(tools: MCPTool[]): Map<string, MCPTool[]> {
    const groups = new Map<string, MCPTool[]>();

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
