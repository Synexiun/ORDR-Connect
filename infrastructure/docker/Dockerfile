# ORDR-Connect — DEPRECATED: Use service-specific Dockerfiles
#
# This file is kept for backward compatibility only.
# Use the per-service Dockerfiles instead:
#   - Dockerfile.api              → Core API (Hono)
#   - Dockerfile.worker           → Kafka consumer / background jobs
#   - Dockerfile.agent-runtime    → AI agent orchestrator
#   - Dockerfile.web              → React SPA (nginx)
#   - Dockerfile.developer-portal → SDK docs / API explorer
#
# Build example:
#   docker build -f infrastructure/docker/Dockerfile.api -t ordr-api .

# Default: build the API service
FROM node:22.14-alpine3.20 AS builder

RUN corepack enable && corepack prepare pnpm@9.15.4 --activate
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json turbo.json ./
COPY apps/api/package.json ./apps/api/
COPY packages/core/package.json ./packages/core/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/auth/package.json ./packages/auth/
COPY packages/audit/package.json ./packages/audit/
COPY packages/db/package.json ./packages/db/
COPY packages/events/package.json ./packages/events/
COPY packages/compliance/package.json ./packages/compliance/
COPY packages/channels/package.json ./packages/channels/
COPY packages/graph/package.json ./packages/graph/
COPY packages/analytics/package.json ./packages/analytics/
COPY packages/ai/package.json ./packages/ai/
COPY packages/decision-engine/package.json ./packages/decision-engine/
COPY packages/sdk/package.json ./packages/sdk/

RUN pnpm install --frozen-lockfile
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
RUN pnpm --filter @ordr/api... build
RUN pnpm install --frozen-lockfile --prod

FROM gcr.io/distroless/nodejs22-debian12 AS runtime

LABEL org.opencontainers.image.title="ordr-connect-api"
LABEL org.opencontainers.image.vendor="Synexiun"
LABEL org.opencontainers.image.version="0.1.0"

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/package.json ./apps/api/
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/core/package.json ./packages/core/
COPY --from=builder /app/packages/crypto/dist ./packages/crypto/dist
COPY --from=builder /app/packages/crypto/package.json ./packages/crypto/
COPY --from=builder /app/packages/auth/dist ./packages/auth/dist
COPY --from=builder /app/packages/auth/package.json ./packages/auth/
COPY --from=builder /app/packages/audit/dist ./packages/audit/dist
COPY --from=builder /app/packages/audit/package.json ./packages/audit/
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/package.json ./packages/db/
COPY --from=builder /app/packages/events/dist ./packages/events/dist
COPY --from=builder /app/packages/events/package.json ./packages/events/
COPY --from=builder /app/packages/compliance/dist ./packages/compliance/dist
COPY --from=builder /app/packages/compliance/package.json ./packages/compliance/
COPY --from=builder /app/packages/channels/dist ./packages/channels/dist
COPY --from=builder /app/packages/channels/package.json ./packages/channels/
COPY --from=builder /app/packages/graph/dist ./packages/graph/dist
COPY --from=builder /app/packages/graph/package.json ./packages/graph/
COPY --from=builder /app/packages/analytics/dist ./packages/analytics/dist
COPY --from=builder /app/packages/analytics/package.json ./packages/analytics/
COPY --from=builder /app/infrastructure/docker/healthcheck.mjs ./healthcheck.mjs

USER 1000
ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["/nodejs/bin/node", "healthcheck.mjs"]

CMD ["apps/api/dist/server.js"]
