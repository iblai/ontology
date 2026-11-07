# ============================================================
# gateway/Dockerfile — iblai-ontology MCP exposure gateway
#
# Runs the Django ASGI application (identity gateway + MCP exposure) under
# uvicorn on port 8080. Built from the repo root context so the package
# source is available.
#
#   docker build -f gateway/Dockerfile -t ontology-gateway .
# ============================================================
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /uvx /bin/

WORKDIR /app

# System deps for the source-system drivers (psycopg2, etc.) and git for the auto-ontology source.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential git libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install from uv.lock: the Django backend extra (gateway, sync, etc.; uvicorn included),
# the source drivers, the vector index and the auto-ontology connectors.
COPY . /src
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_DOWNLOADS=never UV_NO_CACHE=1
RUN uv sync --project /src --locked --no-dev --no-editable \
    --extra django --extra db --extra vector --extra auto-ontology
ENV PATH="/opt/venv/bin:$PATH"

EXPOSE 8080

CMD ["uvicorn", "iblai_ontology.backend.asgi:application", \
     "--host", "0.0.0.0", "--port", "8080"]
