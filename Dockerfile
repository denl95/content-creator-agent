# syntax=docker/dockerfile:1

# Node base with Bun on top: Node is required because the Notion publisher spawns
# `npx -y @notionhq/notion-mcp-server`, and Bun is required for bun:sqlite and the
# pipeline itself.
FROM node:22-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://bun.sh/install | bash
ENV PATH="/root/.bun/bin:${PATH}"
WORKDIR /app

# --- Build the Next.js frontend ---------------------------------------------
FROM base AS web-builder
COPY web/package.json web/bun.lock* web/
RUN cd web && (bun install --frozen-lockfile || bun install)
COPY web web
RUN cd web && bun run build

# --- Install backend dependencies -------------------------------------------
FROM base AS api-deps
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# --- Runtime -----------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_PORT=8080
ENV DRAFTS_DB_PATH=/data/app.db
ENV VECTOR_STORE=memory
ENV API_ORIGIN=http://localhost:3000

COPY --from=api-deps /app/node_modules node_modules
COPY package.json bun.lock ./
COPY src src
COPY data/brand data/brand
COPY docker-entrypoint.sh ./

COPY --from=web-builder /app/web/.next/standalone web/
COPY --from=web-builder /app/web/.next/static web/.next/static
COPY --from=web-builder /app/web/public web/public

RUN chmod +x docker-entrypoint.sh
EXPOSE 8080
CMD ["./docker-entrypoint.sh"]
