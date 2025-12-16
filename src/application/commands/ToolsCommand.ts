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
          .map((tool, index) => {
            const params = this.formatParams(tool.inputSchema);
            const paramsStr = params ? `\n      <i>Параметры:</i> ${params}` : '';
            return `  ${index + 1}. <b>${this.escapeHtml(tool.name)}</b>\n      ${this.escapeHtml(tool.description)}${paramsStr}`;
          })
          .join('\n\n');

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

  private formatParams(inputSchema: MCPTool['inputSchema']): string {
    if (!inputSchema?.properties || Object.keys(inputSchema.properties).length === 0) {
      return '';
    }

    const required = new Set(inputSchema.required || []);
    const params: string[] = [];

    for (const [name, schema] of Object.entries(inputSchema.properties)) {
      const prop = schema as { type?: string; description?: string; enum?: string[] };
      const isRequired = required.has(name);
      const reqMark = isRequired ? '' : '?';

      let typeStr = prop.type || 'any';
      if (prop.enum) {
        typeStr = prop.enum.map(v => `"${v}"`).join(' | ');
      }

      const desc = prop.description ? ` - ${prop.description}` : '';
      params.push(`<code>${this.escapeHtml(name)}${reqMark}</code>: ${this.escapeHtml(typeStr)}${this.escapeHtml(desc)}`);
    }

    return '\n        ' + params.join('\n        ');
  }

  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }
}
