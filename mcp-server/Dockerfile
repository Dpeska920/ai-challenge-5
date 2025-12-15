FROM oven/bun:1-alpine

# Install Python and pip for stdio-based MCP servers
RUN apk add --no-cache python3 py3-pip

# Install MCP time server
RUN pip3 install --break-system-packages mcp-server-time

WORKDIR /app

COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile || bun install

COPY . .

EXPOSE 3001

CMD ["bun", "run", "src/index.ts"]
