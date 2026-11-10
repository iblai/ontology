"""``ontology doctor`` — environment & configuration diagnostics."""

from __future__ import annotations

import importlib.util
import os
from dataclasses import dataclass

import typer

from iblai_ontology.ui import console

app = typer.Typer(
    invoke_without_command=True, help="Diagnose config, env, drivers, and connectivity."
)


@dataclass
class Check:
    name: str
    ok: bool
    detail: str = ""


def _driver_available(module: str) -> bool:
    return importlib.util.find_spec(module) is not None


def _services(cfg) -> list[tuple[str, str]]:
    """Each connected service's name and catalog key: services.yaml, or the registry in dm mode."""
    from iblai_ontology.config import dm_store
    from iblai_ontology.config.reader import ConfigReader

    if not dm_store():
        return [
            (svc.get("name"), svc.get("name", svc.get("adapter")))
            for svc in ConfigReader(cfg).get_services()
        ]
    from iblai_ontology.backend import bootstrap

    bootstrap()
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import Service

    return [(service.name, service.adapter) for service in store.filter(Service)]


def run_checks() -> list[Check]:
    """Run all diagnostics and return the results (pure; CLI renders them)."""
    from iblai_ontology.catalog import get_entry
    from iblai_ontology.config import config_dir, credential_key
    from iblai_ontology.config.validator import ConfigValidator

    checks: list[Check] = []

    # 1. Config files present + valid.
    cfg = config_dir()
    checks.append(Check("config dir", cfg.exists(), str(cfg)))
    if cfg.exists():
        result = ConfigValidator(cfg).validate_all()
        for item in result.items:
            checks.append(Check(f"config:{item.file}", item.valid, item.message))

    # 2. Optional extras / drivers.
    for label, module in [
        ("django backend", "django"),
        ("llm:anthropic", "anthropic"),
        ("llm:openai", "openai"),
        ("db:postgres", "psycopg2"),
        ("db:oracle", "oracledb"),
        ("vector:chromadb", "chromadb"),
    ]:
        checks.append(Check(f"extra:{label}", _driver_available(module), module))

    # 3. Env vars the catalog names for each connected service. A service list that
    # cannot be read is a finding of its own, not a silent skip.
    try:
        services = _services(cfg)
    except Exception as exc:
        services = []
        checks.append(Check("services", False, f"could not be read: {exc}"[:200]))
    for name, key in services:
        try:
            entry = get_entry(key)
        except KeyError:
            continue
        missing = [v for v in entry.env if not os.environ.get(v)]
        checks.append(
            Check(
                f"env:{name}",
                not missing,
                "all set" if not missing else f"missing: {', '.join(missing)}",
            )
        )

    # 4. Gateway / Entra config.
    checks.append(
        Check(
            "entra config",
            bool(
                os.environ.get("ENTRA_TENANT_ID") and os.environ.get("ENTRA_CLIENT_ID")
            ),
            "ENTRA_TENANT_ID + ENTRA_CLIENT_ID",
        )
    )

    # 5. Registry encryption key (env var or Compose secret file).
    try:
        checks.append(
            Check(
                "credential key",
                bool(credential_key()),
                "ONTOLOGY_CREDENTIAL_KEY or ONTOLOGY_CREDENTIAL_KEY_FILE",
            )
        )
    except OSError as exc:
        checks.append(Check("credential key", False, str(exc)))
    return checks


@app.callback(invoke_without_command=True)
def doctor(ctx: typer.Context) -> None:
    """Run diagnostics and print a checklist (exit 1 if any hard check fails)."""
    if ctx.invoked_subcommand is not None:
        return
    checks = run_checks()
    hard_fail = False
    for c in checks:
        icon = "[success]✓[/success]" if c.ok else "[warn]•[/warn]"
        console.print(f"  {icon} {c.name}: {c.detail}")
        # Config validity is the only hard gate; extras/env are advisory.
        if not c.ok and c.name.startswith("config:"):
            hard_fail = True
    console.print()
    console.print(
        "[dim]extras/env shown as advisory (•) — install or set as needed.[/dim]"
    )
    if hard_fail:
        raise typer.Exit(code=1)
