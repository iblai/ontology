"""``print_db_url`` — show the database the backend actually resolves to.

Reads only ``settings.DATABASES`` (never opens a connection, so it won't create
the SQLite file as a side effect). Prints the absolute SQLite filesystem path
(with exists/size) or the PostgreSQL URL — with the password (and any other
credential) shown only as a fixed ``*`` mask, never the real value. The fastest
way to confirm ``ONTOLOGY_SQLITE_PATH`` / ``ONTOLOGY_DB_URL`` point where you
expect, which is the usual cause of an empty cache or a 500 on ``/services``.

    django-admin print_db_url      # or: ./dev.sh manage print_db_url
"""

from __future__ import annotations

from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

# Secrets are never printed — the password is replaced by this fixed mask, which
# reveals neither the value nor its length.
_MASK = "*"


def _masked_url(db: dict) -> str:
    """Reconstruct a connection URL for a non-SQLite backend, password masked.

    The real password is never interpolated into the result — only ``_MASK`` is.
    """
    engine = str(db.get("ENGINE", ""))
    scheme = "postgresql" if "postgres" in engine else "db"
    user = str(db.get("USER") or "")
    if user and db.get("PASSWORD"):
        auth = f"{user}:{_MASK}@"
    elif user:
        auth = f"{user}@"
    else:
        auth = ""
    host = str(db.get("HOST") or "localhost")
    port = str(db.get("PORT") or "")
    name = str(db.get("NAME") or "")
    hostport = f"{host}:{port}" if port else host
    return f"{scheme}://{auth}{hostport}/{name}"


class Command(BaseCommand):
    help = "Print the resolved database URL / SQLite filesystem path the backend uses."
    # No DB access here, and skip checks so nothing opens (and creates) the file.
    requires_system_checks: list = []

    def handle(self, *args, **options):
        db = settings.DATABASES["default"]
        engine = str(db.get("ENGINE", ""))
        self.stdout.write(f"engine: {engine}")

        if engine.endswith("sqlite3"):
            name = str(db.get("NAME", ""))
            if name == ":memory:":
                self.stdout.write("path:   :memory: (in-memory, nothing persisted)")
                self.stdout.write("url:    sqlite://:memory:")
                return
            path = Path(name).resolve()
            where = (
                f"exists, {path.stat().st_size} bytes"
                if path.exists()
                else "does NOT exist yet"
            )
            self.stdout.write(f"path:   {path}")
            self.stdout.write(f"status: {where}")
            self.stdout.write(f"url:    sqlite:///{path}")
            return

        # Non-SQLite: the password (and any credential) is shown only as the mask.
        self.stdout.write(f"url:    {_masked_url(db)}")
        self.stdout.write(
            f"host: {db.get('HOST') or 'localhost'}  port: {db.get('PORT') or ''}  "
            f"name: {db.get('NAME') or ''}  user: {db.get('USER') or ''}"
        )
