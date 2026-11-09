# syntax=docker/dockerfile:1.7
# Build context is the repo root (pnpm workspace). Plan: docs/api-plan.md §5 D1.
# Node 22.18+ runs the .ts sources directly (type stripping), so no build step.

# node-pty has no Linux prebuilds, so it compiles from source here.
FROM node:22-slim AS deps
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app
# Manifests before source: the install layer is reused until a package.json or the lockfile changes, not on every
# source edit. The pnpm store is a cache mount, so a changed dependency re-downloads only what changed.
# Every workspace package's manifest is listed here. A new package with no line here makes --frozen-lockfile fail.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/player-core/package.json packages/player-core/
COPY packages/ui-catalog/package.json packages/ui-catalog/
COPY e2e/package.json e2e/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
  pnpm install --frozen-lockfile --filter @learnquest/api...
COPY . .

# Runtime image without the compiler toolchain.
FROM node:22-slim
WORKDIR /app
COPY --from=deps /app /app

ARG GIT_SHA=unknown
ENV NODE_ENV=production
ENV GIT_SHA=$GIT_SHA
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "src/server.ts"]
