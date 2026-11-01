FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir uv==0.8.13

WORKDIR /app
COPY pyproject.toml uv.lock README.md ./
COPY learnquest_engine ./learnquest_engine
RUN uv sync --frozen --no-dev

RUN useradd --system --uid 10001 engine
USER engine

ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD uvicorn learnquest_engine.server:app --host 0.0.0.0 --port ${PORT:-8000}
