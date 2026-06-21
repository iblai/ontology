"""Scaffold a new iblai-ontology deployment directory (`ontology config init`)."""

from __future__ import annotations

from pathlib import Path

from iblai_ontology import ui

_ONTOLOGY_YAML = """\
# iblai-ontology main configuration
llm:
  provider: null            # "anthropic" | "openai" | null (disabled)
  api_key: null             # set via: ontology config llm
  model: null               # default per provider (anthropic=claude-opus-4-8)
  max_tokens: 4096
  temperature: 0.2

paths:
  text_memories: /ontology
  config: ./config
"""

_TOOLS_YAML = """\
# MCP Toolbox tools + toolsets. Generated/extended by `ontology service add`.
kind: source
name: ontology-cache
type: postgres
host: ontology-db
port: 5432
database: ontology
user: ${ONTOLOGY_DB_USER}
password: ${ONTOLOGY_DB_PASSWORD}
---
kind: tool
name: search-students
type: postgres-sql
source: ontology-cache
description: Search for students by name, major, classification, or status.
parameters:
  - name: search_term
    type: string
    description: Partial name, major code, or classification
statement: >
  SELECT id, full_name, email, classification, major_code, major_name,
         cumulative_gpa, enrollment_status, has_active_holds, last_synced_at
  FROM students
  WHERE full_name ILIKE '%' || $1 || '%' OR id = $1
  ORDER BY full_name LIMIT 50
---
kind: toolset
name: admin-analytics-tools
tools:
  - search-students
"""

_ROLES_YAML = """\
# Role -> access mapping. Role *assignment* lives in the ibl.ai platform
# (X-Iblai-Role header); this file only defines what each role can access.
roles:
  default:
    display_name: "Authenticated User (No Role Assigned)"
    memory_paths:
      - /ontology/courses/_index.md
    mcp_toolsets: []
    cache_tables: []
    agents:
      - general-info-agent

  Registrar:
    display_name: "Registrar Staff"
    memory_paths:
      - /ontology/**
    mcp_toolsets:
      - admin-analytics-tools
    cache_tables:
      - "*"
    agents:
      - registrar-agent
"""

_SYNC_YAML = """\
schedules:
  - name: students-full
    cron: "0 2 * * *"
    source: peoplesoft-oracle
    tool: get-all-active-students
    output:
      text_memories: /ontology/students/
      structured_cache: students
    description: Full refresh of all active student records
"""

_SERVICES_YAML = "services: []\n"

_ENV_EXAMPLE = """\
# Local iblai-ontology DB
ONTOLOGY_DB_USER=ontology
ONTOLOGY_DB_PASSWORD=change-me

# Microsoft Entra ID
ENTRA_TENANT_ID=<university-tenant-id>
ENTRA_CLIENT_ID=<iblai-ontology-app-client-id>
"""

_COMPOSE = """\
# Minimal compose stub — see docs/deployment.md for the full stack.
version: "3.9"
services:
  ontology-db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: ontology
      POSTGRES_USER: ${ONTOLOGY_DB_USER}
      POSTGRES_PASSWORD: ${ONTOLOGY_DB_PASSWORD}
    volumes:
      - ontology-data:/var/lib/postgresql/data
volumes:
  ontology-data:
"""


class Initializer:
    """Creates the directory structure and default config files."""

    def __init__(self, directory: str | Path) -> None:
        self.root = Path(directory)

    def run(self, *, with_samples: bool = True) -> None:
        config = self.root / "config"
        config.mkdir(parents=True, exist_ok=True)
        (self.root / "ontology").mkdir(exist_ok=True)
        (self.root / "sql").mkdir(exist_ok=True)

        files = {
            config / "ontology.yaml": _ONTOLOGY_YAML,
            self.root / ".env.example": _ENV_EXAMPLE,
            self.root / "docker-compose.yml": _COMPOSE,
        }
        if with_samples:
            files.update(
                {
                    config / "tools.yaml": _TOOLS_YAML,
                    config / "roles.yaml": _ROLES_YAML,
                    config / "sync-schedules.yaml": _SYNC_YAML,
                    config / "services.yaml": _SERVICES_YAML,
                }
            )

        for path, content in files.items():
            if path.exists():
                ui.warn(f"exists, skipping: {path}")
                continue
            path.write_text(content)
            ui.success(f"created {path}")

        ui.success(f"Initialized iblai-ontology deployment in {self.root}/")
