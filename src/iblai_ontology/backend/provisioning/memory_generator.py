"""Text-memory template generation (Component 6.2).

Materializes Jinja2 templates per entity group and renders entity dicts into the
Markdown "text memories" that agents read. The default templates live alongside
this module; a deployment can override them under ``templates/``.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

# Default per-entity templates shipped with the package.
DEFAULT_TEMPLATES: dict[str, str] = {
    "student": """\
# Student: {{ full_name }} ({{ id }})

Last synced: {{ last_synced_at }}
Sources: {{ sources | join(", ") }}

## Academic Program
- Classification: {{ classification }}
- Program: {{ acad_program }}
- Major: {{ major_name }}
- Cumulative GPA: {{ cumulative_gpa }}
- Enrollment Status: {{ enrollment_status }}

## Holds
{% if holds %}{% for h in holds %}- {{ h.hold_description }} ({{ h.placed_by_dept }})
{% endfor %}{% else %}- No active holds
{% endif %}
""",
    "course": """\
# Course: {{ id }} — {{ title }}

Last synced: {{ last_synced_at }}

- Department: {{ department }}
- Credits: {{ credits }}
- Description: {{ description }}
""",
    "generic": """\
# {{ title | default(id) }}

Last synced: {{ last_synced_at }}

{% for key, value in fields.items() %}- {{ key }}: {{ value }}
{% endfor %}
""",
}


class MemoryGenerator:
    """Renders entity dicts into Markdown text memories using Jinja2 templates."""

    def __init__(self, templates_dir: str | Path | None = None) -> None:
        from jinja2 import Environment, StrictUndefined

        self.templates_dir = Path(templates_dir) if templates_dir else None
        self.env = Environment(
            undefined=StrictUndefined, trim_blocks=True, lstrip_blocks=True
        )

    def _template_source(self, entity_group: str) -> str:
        if self.templates_dir:
            candidate = self.templates_dir / f"{entity_group}.md.j2"
            if candidate.exists():
                return candidate.read_text()
        return DEFAULT_TEMPLATES.get(entity_group, DEFAULT_TEMPLATES["generic"])

    def render(self, entity_group: str, context: dict[str, Any]) -> str:
        """Render a single entity to Markdown."""
        template = self.env.from_string(self._template_source(entity_group))
        return template.render(**context)

    def write_templates(self, output_dir: str | Path) -> list[str]:
        """Materialize the default templates into a deployment ``templates/`` dir."""
        out = Path(output_dir)
        out.mkdir(parents=True, exist_ok=True)
        written = []
        for name, src in DEFAULT_TEMPLATES.items():
            path = out / f"{name}.md.j2"
            if not path.exists():
                path.write_text(src)
            written.append(str(path))
        return written
