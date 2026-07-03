"""Local MCP tool tester (backs `ontology mcp test`).

Calls a tool the same way the gateway would, but with an unscoped/admin context
so an operator can smoke-test connectivity to the inbound MCP Toolbox.
"""

from __future__ import annotations

from typing import Any

from iblai_ontology.backend.identity.roles import Permissions
from iblai_ontology.backend.mcp_server.handlers import MCPContext, MCPHandlers


class ToolTester:
    """Executes a single tool with a permissive (operator) context."""

    def __init__(self) -> None:
        # Operator context: wildcard toolsets so any configured tool is callable.
        self._ctx = MCPContext(
            permissions=Permissions(
                role="IblaiOntologyAdmin",
                display_name="Operator",
                mcp_toolsets=["*"],
                cache_tables=["*"],
                admin_dashboard=True,
            )
        )

    def call(self, tool: str, params: dict[str, Any]) -> Any:
        return MCPHandlers(self._ctx).call_tool(tool, params)
