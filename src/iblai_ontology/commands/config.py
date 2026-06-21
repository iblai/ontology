"""``ontology config *`` — configuration management.

The config layer is intentionally Django-free so ``ontology config`` works on a
fresh checkout before any backend services exist.
"""

from __future__ import annotations

from typing import Optional

import typer

app = typer.Typer(no_args_is_help=True, help="Configuration management.")


@app.command()
def init(
    directory: str = typer.Argument(".", help="Directory to initialize."),
    with_samples: bool = typer.Option(True, help="Include sample configuration."),
) -> None:
    """Initialize a new iblai-ontology deployment (dirs, configs, compose)."""
    from iblai_ontology.config.initializer import Initializer

    Initializer(directory).run(with_samples=with_samples)


@app.command()
def show(section: Optional[str] = typer.Argument(None, help="Config section.")) -> None:
    """Display current configuration (redacting secrets)."""
    from iblai_ontology.config.reader import ConfigReader

    reader = ConfigReader()
    if section:
        typer.echo(reader.get_section(section))
    else:
        typer.echo(reader.show_all(redact=True))


@app.command(name="set")
def set_value(
    key: str = typer.Argument(..., help="Config key (dot-notation)."),
    value: str = typer.Argument(..., help="Config value."),
) -> None:
    """Set a configuration value, e.g. `ontology config set llm.provider anthropic`."""
    from iblai_ontology.config.writer import ConfigWriter

    ConfigWriter().set(key, value)
    typer.echo(f"Set {key} = {value}")


@app.command()
def llm(
    provider: str = typer.Option(..., prompt="LLM provider (anthropic/openai)"),
    api_key: str = typer.Option(..., prompt="API key", hide_input=True),
    model: Optional[str] = typer.Option(None, help="Model name override."),
) -> None:
    """Configure the BYOK LLM API key for schema analysis."""
    from iblai_ontology.config.writer import ConfigWriter

    ConfigWriter().set_llm(provider=provider, api_key=api_key, model=model)
    typer.echo(f"LLM configured: {provider}")


@app.command()
def validate() -> None:
    """Validate all configuration files."""
    from iblai_ontology.config.validator import ConfigValidator

    result = ConfigValidator().validate_all()
    for item in result.items:
        icon = "OK" if item.valid else "ERR"
        typer.echo(f"  [{icon}] {item.file}: {item.message}")
    if not result.all_valid:
        raise typer.Exit(code=1)
