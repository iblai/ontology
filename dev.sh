#!/usr/bin/env bash
# Local dev helper for iblai-ontology. Mirrors the CI gates (ruff + pytest) so
# you can confirm everything passes BEFORE committing.
#
# Tests run in your active Python env — activate the pyenv `ontology` virtualenv
# (Python 3.11+) first, or set PYTHON=/path/to/python. Lint uses the same pinned
# ruff version as CI, via `uvx` (no need to install ruff into your env).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

RUFF_VERSION="0.14.14"
PYTHON="${PYTHON:-python}"

# Run the CI-pinned ruff: prefer uvx, fall back to a ruff on PATH.
run_ruff() {
	if command -v uvx >/dev/null 2>&1; then
		uvx "ruff@${RUFF_VERSION}" "$@"
	elif command -v ruff >/dev/null 2>&1; then
		ruff "$@"
	else
		echo "ruff not found — install uv (https://astral.sh/uv) or 'pip install ruff==${RUFF_VERSION}'" >&2
		exit 1
	fi
}

usage() {
	cat <<EOF
Usage: ./dev.sh <command> [args]

  setup         Install the package with dev+django extras into the active env
  test [args]   Run pytest (args passed through, e.g. ./dev.sh test -k canvas -q)
  fmt           Auto-fix: ruff format + import sort
  lint          Check only (no writes): ruff format --check, import sort, lint
  check         Run lint AND tests — the pre-commit gate (matches CI)
  manage [args] Manage the django project,
                e.g. ./dev.sh manage migrate)
  run_uvicorn [args]  Serve the Django ASGI app via uvicorn (flags passed through,
                e.g. ./dev.sh run_uvicorn --host 0.0.0.0 --port 8000 --reload)

Tests run with '$PYTHON'. Activate the pyenv 'ontology' (3.11+) venv first,
or run e.g.  PYTHON=python3.11 ./dev.sh check
EOF
}

cmd="${1:-}"
shift || true
case "$cmd" in
setup)
	"$PYTHON" -m pip install --upgrade pip
	"$PYTHON" -m pip install -e ".[dev,django]"
	;;
test)
	"$PYTHON" -m pytest "$@"
	;;
fmt)
	run_ruff format .
	run_ruff check --select I --fix .
	;;
lint)
	run_ruff format --check .
	run_ruff check --select I .
	run_ruff check .
	;;
check)
	echo "== ruff format --check =="
	run_ruff format --check .
	echo "== ruff import sort (--select I) =="
	run_ruff check --select I .
	echo "== ruff lint =="
	run_ruff check .
	echo "== pytest =="
	"$PYTHON" -m pytest -q
	echo "All checks passed."
	;;
manage)
	# django-admin (not manage.py) needs the settings module in the env.
	export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-iblai_ontology.backend.settings}"
	django-admin "$@"
	;;
run_uvicorn)
	# Serve the Django ASGI app; asgi.py sets DJANGO_SETTINGS_MODULE itself.
	# Extra args pass through, e.g. --host 0.0.0.0 --port 8000 --reload
	"$PYTHON" -m uvicorn iblai_ontology.backend.asgi:application "$@"
	;;
"" | -h | --help | help)
	usage
	;;
*)
	echo "Unknown command: $cmd" >&2
	usage
	exit 1
	;;
esac
