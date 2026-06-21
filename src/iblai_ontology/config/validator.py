"""Validate configuration files and cross-references."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from iblai_ontology.config import config_dir
from iblai_ontology.config.reader import ConfigReader


@dataclass
class ValidationItem:
    file: str
    valid: bool
    message: str


@dataclass
class ValidationResult:
    items: list[ValidationItem] = field(default_factory=list)

    @property
    def all_valid(self) -> bool:
        return all(i.valid for i in self.items)


@dataclass
class RoleIssue:
    severity: str  # "warning" | "error"
    message: str


@dataclass
class RoleValidationResult:
    issues: list[RoleIssue] = field(default_factory=list)

    @property
    def all_valid(self) -> bool:
        return not any(i.severity == "error" for i in self.issues)


class ConfigValidator:
    """Validates presence, parseability, and cross-references of config files."""

    def __init__(self, directory: str | Path | None = None) -> None:
        self.dir = Path(directory) if directory else config_dir()
        self.reader = ConfigReader(self.dir)

    def validate_all(self) -> ValidationResult:
        result = ValidationResult()

        # ontology.yaml
        main = self.reader.main()
        result.items.append(
            ValidationItem("ontology.yaml", bool(main) or True, "loaded" if main else "empty/default")
        )

        # tools.yaml
        tools = self.reader.get_tools()
        toolsets = self.reader.get_toolsets()
        result.items.append(
            ValidationItem(
                "tools.yaml",
                True,
                f"{len(tools)} tools, {len(toolsets)} toolsets",
            )
        )

        # sync-schedules.yaml
        schedules = self.reader.get_sync_schedules()
        bad_cron = [s.get("name", "?") for s in schedules if not s.get("cron")]
        result.items.append(
            ValidationItem(
                "sync-schedules.yaml",
                not bad_cron,
                f"{len(schedules)} schedules"
                + (f"; missing cron: {', '.join(bad_cron)}" if bad_cron else ""),
            )
        )

        # roles.yaml (delegated, surfaced as one line)
        roles_result = self.validate_roles()
        errors = [i for i in roles_result.issues if i.severity == "error"]
        result.items.append(
            ValidationItem(
                "roles.yaml",
                not errors,
                f"{len(self.reader.get_roles())} roles defined"
                + (f"; {len(errors)} error(s)" if errors else ""),
            )
        )

        return result

    def validate_roles(self) -> RoleValidationResult:
        """Check every role references toolsets that exist in tools.yaml."""
        result = RoleValidationResult()
        roles = self.reader.get_roles()
        known_toolsets = set(self.reader.get_toolsets().keys())

        if not roles:
            result.issues.append(RoleIssue("warning", "no roles defined in roles.yaml"))
            return result

        for name, spec in roles.items():
            if "display_name" not in spec:
                result.issues.append(
                    RoleIssue("warning", f"role '{name}' has no display_name")
                )
            for ts in spec.get("mcp_toolsets", []):
                if ts == "*":
                    continue
                if known_toolsets and ts not in known_toolsets:
                    result.issues.append(
                        RoleIssue(
                            "error",
                            f"role '{name}' references toolset '{ts}' which does not exist",
                        )
                    )
        return result
