"""Terminal UI primitives shared across the CLI (mirrors infra-cli's ui.py)."""

from __future__ import annotations

from rich.console import Console
from rich.theme import Theme

_theme = Theme(
    {
        "brand": "bold #1f6feb",
        "highlight": "bold cyan",
        "success": "bold green",
        "warn": "bold yellow",
        "error": "bold red",
    }
)

console = Console(theme=_theme)


def banner() -> None:
    """Print the product banner."""
    console.print()
    console.print("  [brand]iblai-ontology[/brand] — on-premise knowledge layer")
    console.print("  [dim]https://ibl.ai/ontology[/dim]")
    console.print()


def step_header(step: int, total: int, title: str) -> None:
    console.print(f"  [brand][{step}/{total}][/brand] [highlight]{title}[/highlight]")


def success(message: str) -> None:
    console.print(f"  [success]✓[/success] {message}")


def warn(message: str) -> None:
    console.print(f"  [warn]![/warn] {message}")


def error(message: str) -> None:
    console.print(f"  [error]✗[/error] {message}")


def newline() -> None:
    console.print()
