import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GitHubService } from "../github.service.js";

export function registerIssueTools(server: McpServer): void {
  server.registerTool(
    "get_issues",
    {
      description:
        "Get list of issues from a GitHub repository. Returns issue number, title, state, labels, and creation date.",
      inputSchema: {
        repo: z.string().describe('Repository in format "owner/repo"'),
        state: z
          .enum(["open", "closed", "all"])
          .default("open")
          .describe("Filter by issue state"),
        labels: z
          .array(z.string())
          .optional()
          .describe("Filter by labels"),
      },
    },
    async (args) => {
      try {
        const issues = await GitHubService.getIssues(
          args.repo,
          args.state,
          args.labels
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(issues, null, 2) },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "get_issue",
    {
      description:
        "Get detailed information about a specific issue including body, assignees, and comment count.",
      inputSchema: {
        repo: z.string().describe('Repository in format "owner/repo"'),
        issue_number: z.number().int().positive().describe("Issue number"),
      },
    },
    async (args) => {
      try {
        const issue = await GitHubService.getIssue(args.repo, args.issue_number);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(issue, null, 2) },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "create_issue",
    {
      description: "Create a new issue in a GitHub repository.",
      inputSchema: {
        repo: z.string().describe('Repository in format "owner/repo"'),
        title: z.string().min(1).describe("Issue title"),
        body: z.string().optional().describe("Issue body (markdown supported)"),
        labels: z.array(z.string()).optional().describe("Labels to add to the issue"),
      },
    },
    async (args) => {
      try {
        const result = await GitHubService.createIssue(
          args.repo,
          args.title,
          args.body,
          args.labels
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    "add_issue_comment",
    {
      description: "Add a comment to an existing issue.",
      inputSchema: {
        repo: z.string().describe('Repository in format "owner/repo"'),
        issue_number: z.number().int().positive().describe("Issue number"),
        body: z.string().min(1).describe("Comment body (markdown supported)"),
      },
    },
    async (args) => {
      try {
        const result = await GitHubService.addIssueComment(
          args.repo,
          args.issue_number,
          args.body
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          isError: true,
        };
      }
    }
  );
}
