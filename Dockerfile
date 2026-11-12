# ============================================================
# Dockerfile — the iblai-ontology backend, one image
#
# The gateway (the default command: the Django ASGI application under uvicorn
# on port 8080), the sync worker (Celery worker + beat) and the migrations all
# run from it; deploy/compose.yaml and docker-compose.yml give each its command.
#
#   docker build -t ghcr.io/iblai/ontology:dev .
# ============================================================
FROM python:3.13-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /uvx /bin/

# Ties the published package to its repository on GitHub.
LABEL org.opencontainers.image.source="https://github.com/iblai/ontology"

WORKDIR /app

# System deps for the source-system drivers (psycopg2, etc.) and git for the auto-ontology source.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential git libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install from uv.lock: the Django backend extra (gateway, sync, Celery with its Redis
# client; uvicorn included), the source drivers, the vector index and the auto-ontology
# connectors.
COPY . /src
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_PYTHON_DOWNLOADS=never UV_NO_CACHE=1
RUN uv sync --project /src --locked --no-dev --no-editable \
    --extra django --extra db --extra vector --extra auto-ontology
ENV PATH="/opt/venv/bin:$PATH"

# A neutral starting config: a new, empty config volume mounted here is filled from it.
# Generated config is written under ./config/generated, so the working directory stays /app.
COPY deploy/config/ /app/config/
ENV ONTOLOGY_CONFIG_DIR=/app/config

EXPOSE 8080

CMD ["uvicorn", "iblai_ontology.backend.asgi:application", \
     "--host", "0.0.0.0", "--port", "8080"]
