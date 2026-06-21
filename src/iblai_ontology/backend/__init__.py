"""Django + Celery backend for iblai-ontology.

The long-running services (discovery, provisioning, sync engine, identity
gateway, MCP outbound) live here. The CLI lazy-imports this package and calls
:func:`bootstrap` before touching any ORM model, so the lean CLI surface keeps
working without the ``[django]`` extra installed.
"""

from __future__ import annotations

import os

_BOOTSTRAPPED = False


def bootstrap() -> None:
    """Configure Django settings and run ``django.setup()`` exactly once.

    Raises a friendly error if the optional ``[django]`` extra is not installed.
    """
    global _BOOTSTRAPPED
    if _BOOTSTRAPPED:
        return

    try:
        import django  # noqa: F401
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise RuntimeError(
            "The Django backend is not installed. Install it with:\n"
            "    pip install 'iblai-ontology[django]'"
        ) from exc

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "iblai_ontology.backend.settings")
    import django

    django.setup()
    _BOOTSTRAPPED = True
