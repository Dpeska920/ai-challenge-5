import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerIssueTools } from "./issues.js";
import { registerPullRequestTools } from "./pull-requests.js";
import { registerRepositoryTools } from "./repository.js";

export function registerAllTools(server: McpServer): void {
  registerIssueTools(server);
  registerPullRequestTools(server);
  registerRepositoryTools(server);
}
