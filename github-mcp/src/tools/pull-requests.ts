import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GitHubService } from "../github.service.js";

export function registerPullRequestTools(server: McpServer): void {
  server.registerTool(
    "get_pull_requests",
    {
      description:
        "Get list of pull requests from a GitHub repository. Returns PR number, title, state, author, and creation date.",
      inputSchema: {
        repo: z.string().describe('Repository in format "owner/repo"'),
        state: z
          .enum(["open", "closed", "all"])
          .default("open")
          .describe("Filter by PR state"),
      },
    },
    async (args) => {
      try {
        const prs = await GitHubService.getPullRequests(args.repo, args.state);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(prs, null, 2) },
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
    "get_pull_request",
    {
      description:
        "Get detailed information about a specific pull request including body, files changed, additions, and deletions.",
      inputSchema: {
        repo: z.string().describe('Repository in format "owner/repo"'),
        pr_number: z.number().int().positive().describe("Pull request number"),
      },
    },
    async (args) => {
      try {
        const pr = await GitHubService.getPullRequest(args.repo, args.pr_number);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(pr, null, 2) },
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
    "get_pr_diff",
    {
      description:
        "Get the diff (unified format) for a pull request. Optionally filter to a specific file.",
      inputSchema: {
        repo: z.string().describe('Repository in format "owner/repo"'),
        pr_number: z.number().int().positive().describe("Pull request number"),
        file_path: z
          .string()
          .optional()
          .describe("Optional: filter diff to a specific file path"),
      },
    },
    async (args) => {
      try {
        const diff = await GitHubService.getPRDiff(
          args.repo,
          args.pr_number,
          args.file_path
        );
        return {
          content: [{ type: "text" as const, text: diff }],
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
    "get_pr_files",
    {
      description:
        "Get list of files changed in a pull request with their status, additions, and deletions.",
      inputSchema: {
        repo: z.string().describe('Repository in format "owner/repo"'),
        pr_number: z.number().int().positive().describe("Pull request number"),
      },
    },
    async (args) => {
      try {
        const files = await GitHubService.getPRFiles(args.repo, args.pr_number);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(files, null, 2) },
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
    "create_review_comment",
    {
      description: "Create a general comment on a pull request (review comment).",
      inputSchema: {
        repo: z.string().describe('Repository in format "owner/repo"'),
        pr_number: z.number().int().positive().describe("Pull request number"),
        body: z.string().min(1).describe("Comment body (markdown supported)"),
      },
    },
    async (args) => {
      try {
        const result = await GitHubService.createReviewComment(
          args.repo,
          args.pr_number,
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
