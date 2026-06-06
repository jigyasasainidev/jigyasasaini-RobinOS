# ── Trend Engine — Production Dockerfile ─────────────────
# Uses Bun official image. Single-stage — no build step needed.
# Image is small (~100MB) and starts in <200ms.
FROM oven/bun:1.1-alpine

WORKDIR /app

# Copy dependency manifest first (layer cache)
COPY package.json bun.lockb* ./

# Install production dependencies only
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ ./src/

# Health probe used by Railway/Fly.io
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

# Non-root user for security
USER bun

CMD ["bun", "run", "src/index.ts"]
