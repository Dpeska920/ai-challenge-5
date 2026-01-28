import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { GitHubService } from "../github.service.js";

export function registerRepositoryTools(server: McpServer): void {
  server.registerTool(
    "get_repo_structure",
    {
      description:
        "Get the directory structure of a repository path. Returns list of files and directories with their names, types, and paths.",
      inputSchema: {
        repo: z.string().describe('Repository in format "owner/repo"'),
        path: z
          .string()
          .default("")
          .describe('Path in repository (empty or "/" for root)'),
        ref: z
          .string()
          .optional()
          .describe("Git ref (branch, tag, or commit SHA). Defaults to default branch."),
      },
    },
    async (args) => {
      try {
        const normalizedPath = args.path === "/" ? "" : args.path;
        const structure = await GitHubService.getRepoStructure(
          args.repo,
          normalizedPath,
          args.ref
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(structure, null, 2) },
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
    "get_file_content",
    {
      description:
        "Get the content of a file from a GitHub repository. Returns the file content as text.",
      inputSchema: {
        repo: z.string().describe('Repository in format "owner/repo"'),
        path: z.string().min(1).describe("File path in repository"),
        ref: z
          .string()
          .optional()
          .describe("Git ref (branch, tag, or commit SHA). Defaults to default branch."),
      },
    },
    async (args) => {
      try {
        const content = await GitHubService.getFileContent(
          args.repo,
          args.path,
          args.ref
        );
        return {
          content: [{ type: "text" as const, text: content }],
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
