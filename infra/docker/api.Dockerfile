# Build context is the repo root (pnpm workspace). Plan: docs/api-plan.md §5 D1.
# Node 22.18+ runs the .ts sources directly (type stripping), so no build step.

# node-pty has no Linux prebuilds, so it compiles from source here.
FROM node:22-slim AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile --filter @learnquest/api...

# Runtime image without the compiler toolchain.
FROM node:22-slim
WORKDIR /app
COPY --from=deps /app /app

ENV NODE_ENV=production
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "src/server.ts"]
