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
from corsheaders.defaults import default_headers
from environs import Env

from iblai_ontology.config import LLM_DEFAULT_MODELS, config_dir

# Load a .env file (searched from the working directory upward) into the
# environment before any settings are read. environs does not override vars
# already set in the real environment, so shell/compose values still win.
env = Env()
env.read_env()

BASE_DIR = Path(__file__).resolve().parent

SECRET_KEY = os.environ.get("ONTOLOGY_SECRET_KEY", "dev-insecure-change-me")
DEBUG = os.environ.get("ONTOLOGY_DEBUG", "false").lower() == "true"
ALLOWED_HOSTS = os.environ.get("ONTOLOGY_ALLOWED_HOSTS", "*").split(",")

# --- Logging -------------------------------------------------------------
# Show the *real* reason behind 500s on the console. Django logs unhandled view
# exceptions (what the SPA sees as a bare "500") to the `django.request` logger
# with a full traceback — but its built-in console handler is gated on DEBUG,
# so with DEBUG off you get no cause. Route request errors (and app logs) to
# stderr regardless of DEBUG; tune volume with ONTOLOGY_LOG_LEVEL.
LOG_LEVEL = os.environ.get("ONTOLOGY_LOG_LEVEL", "INFO").upper()
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "verbose": {
            "format": "[{asctime}] {levelname} {name}: {message}",
            "style": "{",
        },
    },
    "handlers": {
        "console": {"class": "logging.StreamHandler", "formatter": "verbose"},
    },
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
    "loggers": {
        # Unhandled 500s land here with exc_info — the full traceback.
        "django.request": {
            "handlers": ["console"],
            "level": "ERROR",
            "propagate": False,
        },
    },
}

INSTALLED_APPS = [
    "django.contrib.contenttypes",
    "django.contrib.auth",
    "rest_framework",
    "corsheaders",
    "iblai_ontology.backend.services",
    "iblai_ontology.backend.discovery",
    "iblai_ontology.backend.provisioning",
    "iblai_ontology.backend.sync",
    "iblai_ontology.backend.identity",
    "iblai_ontology.backend.mcp_server",
    "iblai_ontology.backend.api",
]

MIDDLEWARE: list[str] = [
    # First: answer CORS preflight (OPTIONS) before anything else. The console
    # SPA calls this API cross-origin from :3000 and preflights carry no auth,
    # so CorsMiddleware must short-circuit them ahead of identity/rate-limit.
    "corsheaders.middleware.CorsMiddleware",
    # Then: reject cleartext-borne tokens and wrap every response (including
    # 401/403/429 errors below) with security headers.
    "iblai_ontology.backend.security_headers.OntologySecurityMiddleware",
    "iblai_ontology.backend.identity.middleware.OntologyIdentityMiddleware",
    # After identity so it can key on the resolved subject; falls back to IP.
    "iblai_ontology.backend.ratelimit.OntologyRateLimitMiddleware",
]

# Caddy terminates TLS and forwards the client-facing scheme; trust it so
# request.is_secure() reflects HTTPS behind the proxy. Safe only because the
# gateway is reachable exclusively via the proxy in production, never on :8080.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

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

# --- Cache (backs gateway rate limiting) ---------------------------------
# Set ONTOLOGY_CACHE_URL to a redis:// URL to enforce rate limits across worker
# processes (requires the redis client). Without it, a per-process in-memory
# cache is used — still throttles, but each worker counts independently.
_cache_url = os.environ.get("ONTOLOGY_CACHE_URL")
if _cache_url and _cache_url.startswith("redis"):
    CACHES = {
        "default": {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": _cache_url,
        }
    }
else:
    CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}

# --- Gateway rate limiting -----------------------------------------------
RATELIMIT_ENABLED = (
    os.environ.get("ONTOLOGY_RATELIMIT_ENABLED", "true").lower() == "true"
)
RATELIMIT_WINDOW_SECONDS = int(os.environ.get("ONTOLOGY_RATELIMIT_WINDOW", "60"))
RATELIMIT_MAX_REQUESTS = int(os.environ.get("ONTOLOGY_RATELIMIT_MAX", "120"))
RATELIMIT_TOOLS_CALL_MAX = int(
    os.environ.get("ONTOLOGY_RATELIMIT_TOOLS_CALL_MAX", "30")
)

# --- Transport security / security headers -------------------------------
# Backs OntologySecurityMiddleware: rejects Bearer tokens over cleartext and
# emits protective response headers. All env-configurable (see the README).
SECURITY_HEADERS_ENABLED = (
    os.environ.get("ONTOLOGY_SECURITY_HEADERS_ENABLED", "true").lower() == "true"
)
SECURITY_REQUIRE_HTTPS = (
    os.environ.get("ONTOLOGY_REQUIRE_HTTPS", "true").lower() == "true"
)
SECURITY_HSTS_MAX_AGE = int(os.environ.get("ONTOLOGY_HSTS_MAX_AGE", "31536000"))
SECURITY_HSTS_INCLUDE_SUBDOMAINS = (
    os.environ.get("ONTOLOGY_HSTS_INCLUDE_SUBDOMAINS", "true").lower() == "true"
)
SECURITY_CSP = os.environ.get(
    "ONTOLOGY_CSP", "default-src 'none'; frame-ancestors 'none'"
)
SECURITY_REFERRER_POLICY = os.environ.get("ONTOLOGY_REFERRER_POLICY", "no-referrer")
SECURITY_FRAME_OPTIONS = os.environ.get("ONTOLOGY_FRAME_OPTIONS", "DENY")

# --- JWT replay protection -----------------------------------------------
# Backs the replay guard in OntologyIdentityMiddleware. Entra access tokens are
# reuse-designed, so the default `bind` mode allows a jti to be reused from its
# first-seen client IP while rejecting the same jti from a different IP; `strict`
# enforces single-use; `off` disables. Backed by the Django cache (share it via
# ONTOLOGY_CACHE_URL for cross-worker coverage). See the README.
JWT_REPLAY_MODE = os.environ.get("ONTOLOGY_JWT_REPLAY_MODE", "bind").lower()
JWT_REPLAY_TTL_FALLBACK = int(
    os.environ.get("ONTOLOGY_JWT_REPLAY_TTL_FALLBACK", "3600")
)

# --- REST API for the admin console (DRF) ---------------------------------
# Two Authorization schemes: `Bearer <entra-jwt>` (resolved by the identity
# middleware above into request.ontology) and `Token <dm_token>` plus an
# `X-Edx-Jwt` header (verified against the ibl.ai DM and LMS — see
# backend/api/auth.py). Leaving the DM/LMS URLs unset disables the Token
# scheme; the API stays platform-agnostic (any platform's active admin).
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "iblai_ontology.backend.api.auth.DmTokenAuthentication",
        "iblai_ontology.backend.api.auth.OntologyAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "iblai_ontology.backend.api.auth.AdminDashboardPermission",
    ],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PARSER_CLASSES": ["rest_framework.parsers.JSONParser"],
    "UNAUTHENTICATED_USER": None,
}
ONTOLOGY_DM_URL = os.environ.get("ONTOLOGY_DM_URL", "").rstrip("/")
ONTOLOGY_LMS_URL = os.environ.get("ONTOLOGY_LMS_URL", "").rstrip("/")
ONTOLOGY_DM_VERIFY_TTL = int(os.environ.get("ONTOLOGY_DM_VERIFY_TTL", "300"))
# Optional allowlist of platform keys/orgs the console trusts. Empty (default)
# keeps the platform-agnostic behaviour (any platform's active admin qualifies);
# set it to scope console admin to specific platforms — important when DM/LMS is
# the shared ibl.ai platform, where an unrelated platform's admin would otherwise
# gain full control. Matched against each membership's ``key`` or ``org``.
ONTOLOGY_ADMIN_PLATFORMS = {
    p.strip()
    for p in os.environ.get("ONTOLOGY_ADMIN_PLATFORMS", "").split(",")
    if p.strip()
}
# Local dev without Entra/DM: anonymous requests act as a synthetic admin.
ONTOLOGY_API_DEV_ALLOW_ANON = (
    os.environ.get("ONTOLOGY_API_DEV_ALLOW_ANON", "false").lower() == "true"
)

# --- CORS (the console SPA calls this API cross-origin from :3000) --------
# Only browser origins that host the console need listing; the two tokens
# travel in request headers (no cookies), so credentials stay off. The custom
# X-Edx-Jwt header must be allowlisted on top of the DRF/CORS defaults.
CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "ONTOLOGY_CORS_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if origin.strip()
]
CORS_ALLOW_HEADERS = (*default_headers, "x-edx-jwt")
