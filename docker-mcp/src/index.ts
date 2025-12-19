import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express, { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import Docker from 'dockerode';

const PORT = process.env.PORT || 3005;
const IS_SECURE_ENV = process.env.IS_SECURE_ENV === 'true';

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

function formatUptime(startedAt: string): string {
  const started = new Date(startedAt);
  const now = new Date();
  const diffMs = now.getTime() - started.getTime();

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

async function findContainer(namePattern: string): Promise<Docker.ContainerInfo | null> {
  const containers = await docker.listContainers({ all: true });
  const pattern = namePattern.toLowerCase();

  // Exact match first
  let found = containers.find(c =>
    c.Names.some(n => n.replace(/^\//, '').toLowerCase() === pattern)
  );

  // Partial match if no exact match
  if (!found) {
    found = containers.find(c =>
      c.Names.some(n => n.toLowerCase().includes(pattern))
    );
  }

  return found || null;
}

function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'docker-mcp',
    version: '1.0.0',
  });

  // Tool 1: List all containers with status and uptime
  server.registerTool(
    'listContainers',
    {
      description: 'Get list of all Docker containers with their status, state, and uptime',
      inputSchema: {
        showAll: z.boolean().optional().describe('Include stopped containers (default: true)'),
      },
    },
    async (args) => {
      try {
        const showAll = args.showAll !== false;
        const containers = await docker.listContainers({ all: showAll });

        if (containers.length === 0) {
          return {
            content: [{ type: 'text' as const, text: 'No containers found.' }]
          };
        }

        const containerList = await Promise.all(containers.map(async (c) => {
          const name = c.Names[0]?.replace(/^\//, '') || 'unknown';
          const state = c.State;
          const status = c.Status;

          let uptime = 'N/A';
          if (state === 'running') {
            try {
              const container = docker.getContainer(c.Id);
              const inspect = await container.inspect();
              uptime = formatUptime(inspect.State.StartedAt);
            } catch {
              uptime = 'unknown';
            }
          }

          return `- ${name}: ${state} (${status}) | Uptime: ${uptime}`;
        }));

        const result = `Docker Containers (${containers.length} total):\n\n${containerList.join('\n')}`;

        return {
          content: [{ type: 'text' as const, text: result }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error listing containers: ${errorMessage}` }]
        };
      }
    }
  );

  // Tool 2: Get container status with name search
  server.registerTool(
    'getContainerStatus',
    {
      description: 'Get status of a specific container. Supports partial name matching (e.g., "bot" will find "ai-bot")',
      inputSchema: {
        name: z.string().describe('Container name or partial name to search for'),
      },
    },
    async (args) => {
      try {
        const containerInfo = await findContainer(args.name);

        if (!containerInfo) {
          return {
            content: [{ type: 'text' as const, text: `Container matching "${args.name}" not found.` }]
          };
        }

        const container = docker.getContainer(containerInfo.Id);
        const inspect = await container.inspect();

        const name = containerInfo.Names[0]?.replace(/^\//, '') || 'unknown';
        const state = inspect.State;
        const uptime = state.Running ? formatUptime(state.StartedAt) : 'N/A';

        const result = [
          `Container: ${name}`,
          `ID: ${containerInfo.Id.substring(0, 12)}`,
          `Image: ${containerInfo.Image}`,
          `State: ${state.Status}`,
          `Running: ${state.Running}`,
          `Uptime: ${uptime}`,
          `Started At: ${state.StartedAt}`,
          `Restart Count: ${inspect.RestartCount}`,
          `Health: ${state.Health?.Status || 'no healthcheck'}`,
        ].join('\n');

        return {
          content: [{ type: 'text' as const, text: result }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error getting container status: ${errorMessage}` }]
        };
      }
    }
  );

  // Tool 3: Get container logs
  server.registerTool(
    'getContainerLogs',
    {
      description: 'Get logs from a specific container. Returns last N lines (default: 20)',
      inputSchema: {
        name: z.string().describe('Container name or partial name'),
        lines: z.number().optional().describe('Number of log lines to retrieve (default: 20, max: 100)'),
      },
    },
    async (args) => {
      try {
        const containerInfo = await findContainer(args.name);

        if (!containerInfo) {
          return {
            content: [{ type: 'text' as const, text: `Container matching "${args.name}" not found.` }]
          };
        }

        const container = docker.getContainer(containerInfo.Id);
        const lines = Math.min(args.lines || 20, 100);

        const logs = await container.logs({
          stdout: true,
          stderr: true,
          tail: lines,
          timestamps: true,
        });

        // Docker logs come as Buffer, need to clean up the stream header bytes
        let logText = logs.toString('utf8');
        // Remove Docker stream header bytes (8 bytes per line for multiplexed streams)
        logText = logText.replace(/[\x00-\x08]/g, '').trim();

        const containerName = containerInfo.Names[0]?.replace(/^\//, '') || 'unknown';

        if (!logText) {
          return {
            content: [{ type: 'text' as const, text: `No logs available for container "${containerName}"` }]
          };
        }

        const result = `Logs for ${containerName} (last ${lines} lines):\n\n${logText}`;

        return {
          content: [{ type: 'text' as const, text: result }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error getting container logs: ${errorMessage}` }]
        };
      }
    }
  );

  // Tool 4: Get container resource stats
  server.registerTool(
    'getContainerStats',
    {
      description: 'Get resource usage statistics (CPU, memory) for a running container',
      inputSchema: {
        name: z.string().describe('Container name or partial name'),
      },
    },
    async (args) => {
      try {
        const containerInfo = await findContainer(args.name);

        if (!containerInfo) {
          return {
            content: [{ type: 'text' as const, text: `Container matching "${args.name}" not found.` }]
          };
        }

        if (containerInfo.State !== 'running') {
          return {
            content: [{ type: 'text' as const, text: `Container "${args.name}" is not running. Stats only available for running containers.` }]
          };
        }

        const container = docker.getContainer(containerInfo.Id);
        const stats = await container.stats({ stream: false });

        // Calculate CPU percentage
        const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
        const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
        const cpuCount = stats.cpu_stats.online_cpus || 1;
        const cpuPercent = systemDelta > 0 ? (cpuDelta / systemDelta) * cpuCount * 100 : 0;

        // Calculate memory usage
        const memUsage = stats.memory_stats.usage || 0;
        const memLimit = stats.memory_stats.limit || 0;
        const memPercent = memLimit > 0 ? (memUsage / memLimit) * 100 : 0;

        // Network stats
        const networks = stats.networks || {};
        let netRx = 0, netTx = 0;
        for (const net of Object.values(networks) as any[]) {
          netRx += net.rx_bytes || 0;
          netTx += net.tx_bytes || 0;
        }

        const containerName = containerInfo.Names[0]?.replace(/^\//, '') || 'unknown';

        const result = [
          `Resource Stats for ${containerName}:`,
          ``,
          `CPU: ${cpuPercent.toFixed(2)}%`,
          `Memory: ${formatBytes(memUsage)} / ${formatBytes(memLimit)} (${memPercent.toFixed(2)}%)`,
          `Network RX: ${formatBytes(netRx)}`,
          `Network TX: ${formatBytes(netTx)}`,
        ].join('\n');

        return {
          content: [{ type: 'text' as const, text: result }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error getting container stats: ${errorMessage}` }]
        };
      }
    }
  );

  // Tool 5: Inspect container details
  server.registerTool(
    'inspectContainer',
    {
      description: 'Get detailed information about a container: ports, volumes, environment variables (names only, no values for security)',
      inputSchema: {
        name: z.string().describe('Container name or partial name'),
      },
    },
    async (args) => {
      try {
        const containerInfo = await findContainer(args.name);

        if (!containerInfo) {
          return {
            content: [{ type: 'text' as const, text: `Container matching "${args.name}" not found.` }]
          };
        }

        const container = docker.getContainer(containerInfo.Id);
        const inspect = await container.inspect();

        const containerName = containerInfo.Names[0]?.replace(/^\//, '') || 'unknown';

        // Ports
        const ports = Object.entries(containerInfo.Ports || {})
          .map((p: any) => {
            if (p.PublicPort) {
              return `${p.PrivatePort}/${p.Type} -> ${p.IP || '0.0.0.0'}:${p.PublicPort}`;
            }
            return `${p.PrivatePort}/${p.Type}`;
          });

        // Volumes/Mounts
        const mounts = (inspect.Mounts || []).map((m: any) =>
          `${m.Source} -> ${m.Destination} (${m.Mode || 'rw'})`
        );

        // Environment variables (names only for security)
        const envVars = (inspect.Config.Env || []).map((e: string) => {
          const name = e.split('=')[0];
          return name;
        });

        // Networks
        const networks = Object.keys(inspect.NetworkSettings?.Networks || {});

        const result = [
          `Container Details: ${containerName}`,
          ``,
          `Image: ${inspect.Config.Image}`,
          `Created: ${inspect.Created}`,
          ``,
          `Ports:`,
          ports.length > 0 ? ports.map(p => `  - ${p}`).join('\n') : '  (none)',
          ``,
          `Mounts:`,
          mounts.length > 0 ? mounts.map(m => `  - ${m}`).join('\n') : '  (none)',
          ``,
          `Networks: ${networks.join(', ') || '(none)'}`,
          ``,
          `Environment Variables (names only):`,
          envVars.length > 0 ? envVars.map(e => `  - ${e}`).join('\n') : '  (none)',
        ].join('\n');

        return {
          content: [{ type: 'text' as const, text: result }]
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text' as const, text: `Error inspecting container: ${errorMessage}` }]
        };
      }
    }
  );

  // === DANGEROUS TOOLS (only in non-secure environments) ===
  if (!IS_SECURE_ENV) {
    console.log('[Docker MCP] Registering dangerous tools (IS_SECURE_ENV=false)');

    // Tool 6: Restart container
    server.registerTool(
      'restartContainer',
      {
        description: '[DANGEROUS] Restart a Docker container. Only available in non-secure environments.',
        inputSchema: {
          name: z.string().describe('Container name or partial name'),
          timeout: z.number().optional().describe('Seconds to wait before killing the container (default: 10)'),
        },
      },
      async (args) => {
        try {
          const containerInfo = await findContainer(args.name);

          if (!containerInfo) {
            return {
              content: [{ type: 'text' as const, text: `Container matching "${args.name}" not found.` }]
            };
          }

          const container = docker.getContainer(containerInfo.Id);
          const containerName = containerInfo.Names[0]?.replace(/^\//, '') || 'unknown';
          const timeout = args.timeout ?? 10;

          await container.restart({ t: timeout });

          return {
            content: [{ type: 'text' as const, text: `Container "${containerName}" restarted successfully.` }]
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text' as const, text: `Error restarting container: ${errorMessage}` }]
          };
        }
      }
    );

    // Tool 7: Start container
    server.registerTool(
      'startContainer',
      {
        description: '[DANGEROUS] Start a stopped Docker container. Only available in non-secure environments.',
        inputSchema: {
          name: z.string().describe('Container name or partial name'),
        },
      },
      async (args) => {
        try {
          const containerInfo = await findContainer(args.name);

          if (!containerInfo) {
            return {
              content: [{ type: 'text' as const, text: `Container matching "${args.name}" not found.` }]
            };
          }

          if (containerInfo.State === 'running') {
            const containerName = containerInfo.Names[0]?.replace(/^\//, '') || 'unknown';
            return {
              content: [{ type: 'text' as const, text: `Container "${containerName}" is already running.` }]
            };
          }

          const container = docker.getContainer(containerInfo.Id);
          const containerName = containerInfo.Names[0]?.replace(/^\//, '') || 'unknown';

          await container.start();

          return {
            content: [{ type: 'text' as const, text: `Container "${containerName}" started successfully.` }]
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text' as const, text: `Error starting container: ${errorMessage}` }]
          };
        }
      }
    );

    // Tool 8: Stop container
    server.registerTool(
      'stopContainer',
      {
        description: '[DANGEROUS] Stop a running Docker container. Only available in non-secure environments.',
        inputSchema: {
          name: z.string().describe('Container name or partial name'),
          timeout: z.number().optional().describe('Seconds to wait before killing the container (default: 10)'),
        },
      },
      async (args) => {
        try {
          const containerInfo = await findContainer(args.name);

          if (!containerInfo) {
            return {
              content: [{ type: 'text' as const, text: `Container matching "${args.name}" not found.` }]
            };
          }

          if (containerInfo.State !== 'running') {
            const containerName = containerInfo.Names[0]?.replace(/^\//, '') || 'unknown';
            return {
              content: [{ type: 'text' as const, text: `Container "${containerName}" is not running.` }]
            };
          }

          const container = docker.getContainer(containerInfo.Id);
          const containerName = containerInfo.Names[0]?.replace(/^\//, '') || 'unknown';
          const timeout = args.timeout ?? 10;

          await container.stop({ t: timeout });

          return {
            content: [{ type: 'text' as const, text: `Container "${containerName}" stopped successfully.` }]
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text' as const, text: `Error stopping container: ${errorMessage}` }]
          };
        }
      }
    );
  } else {
    console.log('[Docker MCP] Secure environment - dangerous tools disabled');
  }

  return server;
}

// Session management
const sessions = new Map<string, {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
}>();

const app = express();
app.use(express.json());

// MCP endpoint
app.all('/mcp', async (req: Request, res: Response) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;

  if (req.method === 'POST') {
    let session = sessionId ? sessions.get(sessionId) : undefined;

    if (!session) {
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { server, transport });
          console.log(`[Docker MCP] Session initialized: ${id}`);
        }
      });

      await server.connect(transport);
      session = { server, transport };
    }

    await session.transport.handleRequest(req, res, req.body);
  } else if (req.method === 'GET') {
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: 'Invalid session ID' });
      return;
    }

    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  } else if (req.method === 'DELETE') {
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.close();
      sessions.delete(sessionId);
      console.log(`[Docker MCP] Session closed: ${sessionId}`);
    }
    res.status(200).json({ success: true });
  } else {
    res.status(405).json({ error: 'Method not allowed' });
  }
});

// Health check
app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', sessions: sessions.size });
});

app.listen(PORT, () => {
  console.log(`[Docker MCP] Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('[Docker MCP] Shutting down...');
  for (const [id, session] of sessions) {
    await session.transport.close();
    console.log(`[Docker MCP] Closed session: ${id}`);
  }
  process.exit(0);
});
