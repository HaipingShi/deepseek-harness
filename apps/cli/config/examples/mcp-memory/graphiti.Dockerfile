# syntax=docker/dockerfile:1.9

# Build with the mcp_server directory from Graphiti commit
# 19e44a97a929ebf121294f97f26966f0379d8e30 as the context.
FROM ghcr.io/astral-sh/uv:0.8.22@sha256:9874eb7afe5ca16c363fe80b294fe700e460df29a55532bbfea234a0f12eddb1 AS uv
FROM python:3.11-slim-bookworm@sha256:0bee7276f83efd4a1ee05bbbf4281d95ed28e079220a9457f25a93e3f1e3c31b

COPY --from=uv /uv /uvx /bin/

ENV MCP_SERVER_HOST=0.0.0.0 \
    PATH=/app/mcp/.venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app/mcp

COPY pyproject.toml README.md ./
RUN printf '%s\n' \
      'graphiti-core==0.28.2' \
      'httpx==0.28.1' \
      'mcp==1.26.0' \
      > /tmp/graphiti-constraints.txt \
    && uv venv \
    && uv pip install \
      --python .venv/bin/python \
      --constraint /tmp/graphiti-constraints.txt \
      . 'httpx==0.28.1' \
    && uv pip check --python .venv/bin/python \
    && rm /tmp/graphiti-constraints.txt

COPY main.py ./
COPY src/ ./src/
COPY config/ ./config/

RUN groupadd --system graphiti \
    && useradd --system --gid graphiti --home-dir /app/mcp graphiti \
    && mkdir -p /var/log/graphiti \
    && chown -R graphiti:graphiti /app/mcp /var/log/graphiti

USER graphiti

EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=5s --start-period=15s --retries=3 \
  CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=4)"]

CMD ["python", "main.py"]
