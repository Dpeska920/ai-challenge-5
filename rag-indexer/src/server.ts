import express, { Request, Response } from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import { z } from "zod";

import { initEmbeddings } from "./embeddings";
import { initVectorStore, openTable, search, searchWithThreshold, getStats, reindexWithRecords, isTableReady } from "./vectorStore";
import {
  initDocumentManager,
  listDocuments,
  addDocument,
  deleteDocument,
  indexAllDocuments,
  type DocumentInfo,
} from "./documentManager";

const DATA_PATH = process.env.DATA_PATH || "./data/lancedb";
const DOCS_PATH = process.env.DOCS_PATH || "./docs";
const MODEL_NAME = process.env.MODEL_NAME || "Xenova/all-MiniLM-L6-v2";
const CHUNK_SIZE = parseInt(process.env.CHUNK_SIZE || "500");
const CHUNK_OVERLAP = parseInt(process.env.CHUNK_OVERLAP || "50");

let isIndexing = false;

// Reindex helper
async function performReindex(): Promise<{ success: boolean; message: string; count: number }> {
  if (isIndexing) {
    return { success: false, message: "Indexing already in progress", count: 0 };
  }

  isIndexing = true;
  try {
    const records = await indexAllDocuments();
    await reindexWithRecords(records);
    return {
      success: true,
      message: `Reindex complete: ${records.length} chunks from documents`,
      count: records.length,
    };
  } catch (error) {
    return {
      success: false,
      message: `Reindex failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      count: 0,
    };
  } finally {
    isIndexing = false;
  }
}

// Create MCP server instance
function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "rag-search",
    version: "1.0.0",
  });

  // Search documents
  server.registerTool(
    "searchDocuments",
    {
      description:
        "Поиск по индексированным документам. Использует семантический поиск для нахождения релевантных фрагментов текста.",
      inputSchema: {
        query: z.string().describe("Поисковый запрос на естественном языке"),
        limit: z
          .number()
          .min(1)
          .max(20)
          .optional()
          .describe("Количество результатов (по умолчанию 5, максимум 20)"),
      },
    },
    async (args) => {
      try {
        if (!isTableReady()) {
          return {
            content: [{ type: "text" as const, text: "Индекс пуст. Добавьте документы и выполните индексацию." }],
          };
        }

        const results = await search(args.query, args.limit ?? 5);

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "Ничего не найдено по запросу." }],
          };
        }

        const formattedResults = results
          .map((r, i) => {
            return `[${i + 1}] Источник: ${r.source}\nРелевантность: ${(1 - r.score).toFixed(3)}\n\n${r.text}`;
          })
          .join("\n\n---\n\n");

        return {
          content: [{ type: "text" as const, text: `Найдено ${results.length} результатов:\n\n${formattedResults}` }],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Ошибка поиска: ${error instanceof Error ? error.message : "Unknown error"}` },
          ],
        };
      }
    }
  );

  // Get index stats
  server.registerTool(
    "getIndexStats",
    {
      description: "Получить статистику индекса документов",
      inputSchema: {},
    },
    async () => {
      try {
        const stats = await getStats();
        const docs = await listDocuments();
        return {
          content: [
            {
              type: "text" as const,
              text: `Статистика RAG:\n- Файлов: ${docs.length}\n- Чанков в индексе: ${stats.count}\n- Статус: ${isIndexing ? "Идёт индексация..." : "Готов"}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Ошибка: ${error instanceof Error ? error.message : "Unknown error"}`,
            },
          ],
        };
      }
    }
  );

  // List documents
  server.registerTool(
    "listRagDocuments",
    {
      description: "Получить список всех документов в RAG хранилище",
      inputSchema: {},
    },
    async () => {
      try {
        const docs = await listDocuments();

        if (docs.length === 0) {
          return {
            content: [{ type: "text" as const, text: "Документов пока нет." }],
          };
        }

        const list = docs
          .map((d, i) => `${i + 1}. ${d.name} (${d.type}, ${formatSize(d.size)})`)
          .join("\n");

        return {
          content: [{ type: "text" as const, text: `Документы (${docs.length}):\n${list}` }],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Ошибка: ${error instanceof Error ? error.message : "Unknown error"}` },
          ],
        };
      }
    }
  );

  // Delete document
  server.registerTool(
    "deleteRagDocument",
    {
      description: "Удалить документ из RAG хранилища и переиндексировать",
      inputSchema: {
        filename: z.string().describe("Имя файла для удаления"),
      },
    },
    async (args) => {
      try {
        const result = await deleteDocument(args.filename);

        if (!result.success) {
          return { content: [{ type: "text" as const, text: result.message }] };
        }

        // Auto reindex
        const reindexResult = await performReindex();
        return {
          content: [
            {
              type: "text" as const,
              text: `${result.message}\n${reindexResult.message}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            { type: "text" as const, text: `Ошибка: ${error instanceof Error ? error.message : "Unknown error"}` },
          ],
        };
      }
    }
  );

  // Reindex
  server.registerTool(
    "reindexRag",
    {
      description: "Переиндексировать все документы в RAG хранилище",
      inputSchema: {},
    },
    async () => {
      const result = await performReindex();
      return {
        content: [{ type: "text" as const, text: result.message }],
      };
    }
  );

  return server;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Session management
const sessions = new Map<string, { server: McpServer; transport: StreamableHTTPServerTransport }>();

// Express app
const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.raw({ type: "application/octet-stream", limit: "50mb" }));

// Health check endpoint
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", sessions: sessions.size, indexing: isIndexing });
});

// REST API for document management

// List documents
app.get("/api/documents", async (_req: Request, res: Response) => {
  try {
    const docs = await listDocuments();
    res.json({ success: true, documents: docs });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Add document
app.post("/api/documents", async (req: Request, res: Response) => {
  try {
    const { filename, content, description } = req.body;

    if (!filename || !content) {
      res.status(400).json({ success: false, error: "filename and content required" });
      return;
    }

    // Content can be base64 encoded
    const buffer = Buffer.from(content, "base64");
    const result = await addDocument(filename, buffer, description || "");

    if (!result.success) {
      res.status(400).json(result);
      return;
    }

    // Auto reindex
    const reindexResult = await performReindex();
    res.json({
      success: true,
      message: result.message,
      reindex: reindexResult,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Delete document
app.delete("/api/documents/:filename", async (req: Request, res: Response) => {
  try {
    const { filename } = req.params;
    const result = await deleteDocument(filename);

    if (!result.success) {
      res.status(404).json(result);
      return;
    }

    // Auto reindex
    const reindexResult = await performReindex();
    res.json({
      success: true,
      message: result.message,
      reindex: reindexResult,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Reindex
app.post("/api/reindex", async (_req: Request, res: Response) => {
  try {
    const result = await performReindex();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// Auto-search with threshold (for automatic RAG integration)
// Returns empty array if nothing relevant found
app.post("/api/search", async (req: Request, res: Response) => {
  try {
    const { query, limit = 3, threshold = 0.8 } = req.body;

    if (!query) {
      res.status(400).json({ success: false, error: "query is required" });
      return;
    }

    if (!isTableReady()) {
      res.json({ success: true, results: [], message: "Index is empty" });
      return;
    }

    const results = await searchWithThreshold(query, limit, threshold);

    res.json({
      success: true,
      results: results.map((r) => ({
        text: r.text,
        source: r.source,
        description: r.description,
        relevance: (1 - r.score).toFixed(3),
      })),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: (error as Error).message });
  }
});

// MCP endpoint
app.all("/mcp", async (req: Request, res: Response) => {
  let sessionId = req.headers["mcp-session-id"] as string | undefined;
  let session = sessionId ? sessions.get(sessionId) : undefined;

  if (!session) {
    sessionId = randomUUID();
    const server = createMcpServer();

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => sessionId!,
      onsessioninitialized: (id) => {
        console.log(`[RAG] Session initialized: ${id}`);
      },
    });

    sessions.set(sessionId, { server, transport });
    await server.connect(transport);
    console.log(`[RAG] New session created: ${sessionId}`);
    session = { server, transport };
  }

  if (req.method === "POST") {
    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("[RAG] Error handling request:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  } else if (req.method === "GET") {
    try {
      await session.transport.handleRequest(req, res);
    } catch (error) {
      console.error("[RAG] Error handling SSE:", error);
      if (!res.headersSent) {
        res.status(500).json({ error: "Internal server error" });
      }
    }
  } else if (req.method === "DELETE") {
    if (sessionId && sessions.has(sessionId)) {
      await session.transport.close();
      sessions.delete(sessionId);
      console.log(`[RAG] Session closed: ${sessionId}`);
      res.status(200).json({ message: "Session closed" });
    } else {
      res.status(404).json({ error: "Session not found" });
    }
  } else {
    res.status(405).json({ error: "Method not allowed" });
  }
});

// Start server
async function start() {
  console.log("[RAG] Initializing RAG Server...");
  console.log(`[RAG] Config: docsPath=${DOCS_PATH}, dataPath=${DATA_PATH}`);

  // Ensure docs directory exists
  await Bun.write(`${DOCS_PATH}/.gitkeep`, "");

  // Initialize document manager
  initDocumentManager({
    docsPath: DOCS_PATH,
    chunkSize: CHUNK_SIZE,
    chunkOverlap: CHUNK_OVERLAP,
  });

  // Initialize embedding model
  console.log("[RAG] Loading embedding model...");
  await initEmbeddings(MODEL_NAME);

  // Initialize vector store
  console.log("[RAG] Connecting to LanceDB...");
  await initVectorStore(DATA_PATH);

  try {
    await openTable();
    const stats = await getStats();
    console.log(`[RAG] Index loaded with ${stats.count} chunks`);
  } catch (error) {
    console.log("[RAG] No existing index found. Will create on first document add.");
  }

  const port = Number(process.env.PORT) || 3006;
  app.listen(port, () => {
    console.log(`[RAG] Server running on http://localhost:${port}`);
    console.log(`[RAG] MCP endpoint: http://localhost:${port}/mcp`);
    console.log(`[RAG] REST API: http://localhost:${port}/api/documents`);
  });
}

// Cleanup on shutdown
process.on("SIGINT", async () => {
  console.log("[RAG] Shutting down...");
  for (const [sessionId, session] of sessions) {
    await session.transport.close();
    console.log(`[RAG] Closed session: ${sessionId}`);
  }
  process.exit(0);
});

start().catch((error) => {
  console.error("[RAG] Failed to start:", error);
  process.exit(1);
});
