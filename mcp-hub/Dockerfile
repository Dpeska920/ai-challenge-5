FROM oven/bun:1-alpine

# Install Python for stdio MCP servers
RUN apk add --no-cache python3 py3-pip

# Install MCP servers
RUN pip3 install --break-system-packages mcp-server-time

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

COPY . .

# Default stdio MCP servers (can be overridden via env)
# Format: name:command:arg1:arg2,...
ENV MCP_STDIO_SERVERS="time:python3:-m:mcp_server_time"
ENV PORT=3002

EXPOSE 3002

CMD ["bun", "run", "src/index.ts"]
