# Build from the repo root (see docker-compose.yml): the visual checker needs packages/ui-catalog.
FROM node:22-slim AS checker
# Runtime deps only. Keep the zod pin equal to the version pnpm-lock.yaml resolves for
# packages/ui-catalog (importers: packages/ui-catalog -> zod); bump both together.
WORKDIR /repo/packages/ui-catalog
COPY packages/ui-catalog/package.json ./
COPY packages/ui-catalog/src ./src
RUN npm install --omit=dev --no-save --no-package-lock zod@4.6.7

FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir uv==0.8.13

# Mirror the monorepo layout: visual.py's parents[3] is /repo, so CHECK_SCRIPT resolves to
# /repo/packages/ui-catalog/src/gen/check.ts. Node runs that checker.
COPY --from=checker /usr/local/bin/node /usr/local/bin/node
COPY --from=checker /repo/packages /repo/packages

WORKDIR /repo/services/engine
COPY services/engine/pyproject.toml services/engine/uv.lock services/engine/README.md ./
COPY services/engine/learnquest_engine ./learnquest_engine
# guide.py reads the persona from parents[3] of the package, which is /repo, so ship the prompt there.
COPY INSTRUCTIONS.md /repo/INSTRUCTIONS.md
RUN uv sync --frozen --no-dev

RUN useradd --system --uid 10001 engine
USER engine

ENV PATH="/repo/services/engine/.venv/bin:$PATH"
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA
EXPOSE 8000
CMD uvicorn learnquest_engine.server:app --host 0.0.0.0 --port ${PORT:-8000}
