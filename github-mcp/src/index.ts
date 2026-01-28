import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import { getConfig } from "./config.js";
import { registerAllTools } from "./tools/index.js";

const sessions = new Map<
  string,
  { server: McpServer; transport: StreamableHTTPServerTransport }
>();

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "github-mcp",
    version: "1.0.0",
  });

  registerAllTools(server);

  return server;
}

const app = express();
app.use(express.json());

app.get("/health", (_req: Request, res: Response) => {
  const config = getConfig();
  res.json({
    status: "ok",
    sessions: sessions.size,
    allowedRepos: config.allowedRepos ?? "all",
  });
});

app.all("/mcp", async (req: Request, res: Response) => {
  let sessionId = req.headers["mcp-session-id"] as string | undefined;
  let session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    sessionId = randomUUID();
    const server = createMcpServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId!,
      onsessioninitialized: (id) => {
        console.log(`[GitHub MCP] Session initialized: ${id}`);
      },
    });

    sessions.set(sessionId, { server, transport });
    await server.connect(transport);
    console.log(`[GitHub MCP] New session created: ${sessionId}`);
    session = { server, transport };
  }

  if (req.method === "POST") {
    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[GitHub MCP] Error handling request:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  } else if (req.method === "GET") {
    try {
      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.error("[GitHub MCP] Error handling SSE:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  } else if (req.method === "DELETE") {
    if (sessionId && sessions.has(sessionId)) {
      await session.transport.close();
      sessions.delete(sessionId);
      console.log(`[GitHub MCP] Session closed: ${sessionId}`);
      res.status(200).json({ message: "Session closed" });
    } else {
      res.status(404).json({ error: "Session not found" });
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
});

async function start() {
  const config = getConfig();
  const port = config.port;

  console.log("[GitHub MCP] Starting server...");
  if (config.allowedRepos) {
    console.log(`[GitHub MCP] Allowed repos: ${config.allowedRepos.join(", ")}`);
  } else {
    console.log("[GitHub MCP] All repos allowed (no whitelist configured)");
  }

  app.listen(port, () => {
    console.log(`[GitHub MCP] Server running on http://localhost:${port}`);
    console.log(`[GitHub MCP] MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`[GitHub MCP] Health check: http://localhost:${port}/health`);
  });
}

process.on("SIGINT", async () => {
  console.log("[GitHub MCP] Shutting down...");
  for (const [sessionId, session] of sessions) {
    await session.transport.close();
    console.log(`[GitHub MCP] Closed session: ${sessionId}`);
  }
  process.exit(0);
});

start().catch((error) => {
  console.error("[GitHub MCP] Failed to start:", error);
  process.exit(1);
});
