FROM oven/bun:1-debian

WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Copy source code
COPY . .

# Default command - run server
CMD ["bun", "run", "src/server.ts"]
