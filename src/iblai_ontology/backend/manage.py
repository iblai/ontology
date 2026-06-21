#!/usr/bin/env python
"""Django management entry point for the iblai-ontology backend.

Usage: ``python -m iblai_ontology.backend.manage <command>``.
"""

from __future__ import annotations

import os
import sys


def main() -> None:
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "iblai_ontology.backend.settings")
    try:
        from django.core.management import execute_from_command_line
    except ImportError as exc:  # pragma: no cover
        raise ImportError(
            "Django is not installed. Install the backend extra: "
            "pip install 'iblai-ontology[django]'"
        ) from exc
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
