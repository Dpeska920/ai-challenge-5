FROM oven/bun:1-alpine

# Install Python for stdio MCP servers (optional, may fail on network issues)
# Using virtual environment per PEP 668
RUN apk update && apk add --no-cache python3 && \
    python3 -m venv /opt/venv && \
    /opt/venv/bin/pip install --upgrade pip && \
    /opt/venv/bin/pip install mcp-server-time || \
    echo "Warning: Python/MCP server installation failed, stdio servers will not be available"

# Add venv to PATH for MCP server execution (if available)
ENV PATH="/opt/venv/bin:$PATH"

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
