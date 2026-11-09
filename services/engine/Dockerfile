# syntax=docker/dockerfile:1.7
# Build from the repo root (see docker-compose.yml): the visual checker needs packages/ui-catalog.
FROM node:22-slim AS checker
# Runtime deps only. Keep the zod pin equal to the version pnpm-lock.yaml resolves for
# packages/ui-catalog (importers: packages/ui-catalog -> zod); bump both together.
WORKDIR /repo/packages/ui-catalog
COPY packages/ui-catalog/package.json ./
RUN npm install --omit=dev --no-save --no-package-lock zod@4.6.7
COPY packages/ui-catalog/src ./src

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir uv==0.8.13

# Mirror the monorepo layout: visual.py's parents[3] is /repo, so CHECK_SCRIPT resolves to
# /repo/packages/ui-catalog/src/gen/check.ts. Node runs that checker.
COPY --from=checker /usr/local/bin/node /usr/local/bin/node
COPY --from=checker /repo/packages /repo/packages

WORKDIR /repo/services/engine
# Dependencies first, from the lockfile alone: this layer and its uv cache survive a source edit.
COPY services/engine/pyproject.toml services/engine/uv.lock services/engine/README.md ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev --no-build --no-install-project
COPY services/engine/learnquest_engine ./learnquest_engine
# guide.py reads the persona from parents[3] of the package, which is /repo, so ship the prompt there.
COPY INSTRUCTIONS.md /repo/INSTRUCTIONS.md
# The package itself is not installed: uvicorn imports learnquest_engine from the working directory, and nothing reads
# installed metadata. Installing it would need a local build, which --no-build (no setup scripts) rules out.

RUN useradd --system --uid 10001 engine
USER engine

ENV PATH="/repo/services/engine/.venv/bin:$PATH"
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
EXPOSE 8000
CMD uvicorn learnquest_engine.server:app --host 0.0.0.0 --port ${PORT:-8000}
