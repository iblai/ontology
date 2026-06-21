# ============================================================
# gateway/Dockerfile — iblai-ontology MCP exposure gateway
#
# Runs the Django ASGI application (identity gateway + MCP exposure) under
# uvicorn on port 8080. Built from the repo root context so the package
# source is available.
#
#   docker build -f gateway/Dockerfile -t ontology-gateway .
# ============================================================
FROM python:3.12-slim

WORKDIR /app

# System deps for the source-system drivers (psycopg2, etc.).
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Install the package with the Django backend extra (gateway, sync, etc.),
# plus uvicorn as the ASGI server.
COPY . /src
RUN pip install --no-cache-dir "/src[django,db,vector]" uvicorn[standard]

EXPOSE 8080

CMD ["uvicorn", "iblai_ontology.backend.asgi:application", \
     "--host", "0.0.0.0", "--port", "8080"]
