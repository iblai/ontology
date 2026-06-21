# ============================================================
# sync-engine/Dockerfile — iblai-ontology sync engine
#
# Runs the Celery worker + beat scheduler for the sync engine (Component 2A).
# Beat reads the cron schedules; the worker executes the sync tasks that pull
# from sources via MCP and write to text memories + the Postgres cache.
# Built from the repo root context so the package source is available.
#
#   docker build -f sync-engine/Dockerfile -t ontology-sync-engine .
# ============================================================
FROM python:3.12-slim

WORKDIR /app

# System deps for the source-system drivers (psycopg2, oracledb, etc.).
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install the package with the Django backend extra (Celery lives here),
# plus DB drivers and the vector index used by the sync engine.
COPY . /src
RUN pip install --no-cache-dir "/src[django,db,vector]"

# Run worker and beat together in one container for the on-prem stack.
CMD ["celery", "-A", "iblai_ontology.backend.celery:app", \
     "worker", "--beat", "--loglevel=info"]
