"""iblai-ontology: on-premise knowledge layer for higher education.

A unified, on-premise knowledge layer that makes a university's existing
systems (PeopleSoft, Banner, Canvas, Slate, Navigate, LDAP) queryable by AI
agents over the Model Context Protocol — without extracting institutional data
to any vendor cloud.

This package ships:
  * ``ontology`` — a typer/rich CLI (the operator surface, Component 7)
  * a Django + Celery backend (discovery, provisioning, sync, identity, mcp)

See ``docs/architecture.md`` for the full design.
"""

from __future__ import annotations

__version__ = "0.2.6"

__all__ = ["__version__"]
