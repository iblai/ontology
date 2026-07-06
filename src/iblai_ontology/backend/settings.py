"""Django settings for the iblai-ontology backend.

Configuration is intentionally minimal: this is a headless backend (no admin
auth flows, no templates beyond Jinja memory templates handled outside Django).
Most behavioural config is read from ``config/ontology.yaml`` via the
:mod:`iblai_ontology.config` layer rather than from Django settings.
"""

from __future__ import annotations

import os
from pathlib import Path

import yaml

from iblai_ontology.config import LLM_DEFAULT_MODELS, config_dir

BASE_DIR = Path(__file__).resolve().parent

SECRET_KEY = os.environ.get("ONTOLOGY_SECRET_KEY", "dev-insecure-change-me")
DEBUG = os.environ.get("ONTOLOGY_DEBUG", "false").lower() == "true"
ALLOWED_HOSTS = os.environ.get("ONTOLOGY_ALLOWED_HOSTS", "*").split(",")

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "iblai_ontology.backend.services",
    "iblai_ontology.backend.discovery",
    "iblai_ontology.backend.provisioning",
    "iblai_ontology.backend.sync",
    "iblai_ontology.backend.identity",
    "iblai_ontology.backend.mcp_server",
]

MIDDLEWARE: list[str] = [
    "iblai_ontology.backend.identity.middleware.OntologyIdentityMiddleware",
]

ROOT_URLCONF = "iblai_ontology.backend.urls"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"
USE_TZ = True
TIME_ZONE = os.environ.get("ONTOLOGY_TZ", "UTC")

# --- Database (the local ontology cache) ---------------------------------
# Defaults to SQLite so `manage.py check` and tests run without Postgres;
# production points ONTOLOGY_DB_URL at the PostgreSQL cache.
_db_url = os.environ.get("ONTOLOGY_DB_URL")
if _db_url and _db_url.startswith("postgres"):
    from urllib.parse import urlparse

    parsed = urlparse(_db_url)
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": parsed.path.lstrip("/"),
            "USER": parsed.username,
            "PASSWORD": parsed.password,
            "HOST": parsed.hostname,
            "PORT": parsed.port or 5432,
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": os.environ.get(
                "ONTOLOGY_SQLITE_PATH", str(BASE_DIR / "ontology.sqlite3")
            ),
        }
    }

# --- Ontology config (BYOK LLM, paths) -----------------------------------
_cfg_path = config_dir() / "ontology.yaml"
if _cfg_path.exists():
    with open(_cfg_path) as f:
        ONTOLOGY_CONFIG = yaml.safe_load(f) or {}
else:
    ONTOLOGY_CONFIG = {}

_llm = ONTOLOGY_CONFIG.get("llm", {}) or {}
LLM_PROVIDER = _llm.get("provider")
LLM_API_KEY = _llm.get("api_key")
LLM_MODEL = _llm.get("model") or (
    LLM_DEFAULT_MODELS.get(LLM_PROVIDER) if LLM_PROVIDER else None
)
LLM_MAX_TOKENS = _llm.get("max_tokens", 4096)
LLM_TEMPERATURE = _llm.get("temperature", 0.2)

# Fernet key for encrypting service connection credentials at rest.
CREDENTIAL_ENCRYPTION_KEY = os.environ.get("ONTOLOGY_CREDENTIAL_KEY")

# Text memory root and Entra ID identity config.
ONTOLOGY_FILES_ROOT = os.environ.get("ONTOLOGY_FILES_ROOT", "/ontology")
ENTRA_TENANT_ID = os.environ.get("ENTRA_TENANT_ID")
ENTRA_CLIENT_ID = os.environ.get("ENTRA_CLIENT_ID")

# --- Celery --------------------------------------------------------------
CELERY_BROKER_URL = os.environ.get("ONTOLOGY_CELERY_BROKER", "redis://localhost:6379/0")
CELERY_RESULT_BACKEND = os.environ.get("ONTOLOGY_CELERY_BACKEND", CELERY_BROKER_URL)
CELERY_TIMEZONE = TIME_ZONE
