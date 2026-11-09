# ============================================================
# sync-engine/Dockerfile — iblai-ontology sync engine
#
# Runs the Celery worker + beat scheduler for the sync engine (Component 2A).
# Beat reads the cron schedules; the worker executes the sync tasks that read each
# source (its own connection, or its custom MCP server) and write to text memories
# + the Postgres cache.
# Built from the repo root context so the package source is available.
#
#   docker build -f sync-engine/Dockerfile -t ontology-sync-engine .
# ============================================================
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /uvx /bin/

WORKDIR /app

# System deps for the source-system drivers (psycopg2, oracledb, etc.).
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install from uv.lock: the Django backend extra (Celery lives here), the DB drivers and
# auto-ontology connectors the sync reads sources through, and the vector index.
COPY . /src
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_DOWNLOADS=never UV_NO_CACHE=1
RUN uv sync --project /src --locked --no-dev --no-editable \
    --extra django --extra db --extra vector --extra auto-ontology
ENV PATH="/opt/venv/bin:$PATH"

# Run worker and beat together in one container for the on-prem stack.
CMD ["celery", "-A", "iblai_ontology.backend.celery:app", \
     "worker", "--beat", "--loglevel=info"]
