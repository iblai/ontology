# mcp-servers/navigate/server.py
#
# EAB Navigate custom MCP server (advising / student success). Read-only.
# Credential isolation: this process only ever sees Navigate credentials.

import json
import os
from urllib.parse import quote

import httpx
from mcp.server.fastmcp import FastMCP
from mcp.types import TextContent

server = FastMCP("navigate-mcp")


def _base_url() -> str:
    return os.environ["NAVIGATE_BASE_URL"]


def _auth() -> dict:
    return {"Authorization": f"Bearer {os.environ['NAVIGATE_API_KEY']}"}


def _safe_segment(value: str) -> str:
    """URL-encode one path segment, rejecting path/route metacharacters.

    A crafted ``student_sis_id`` (extra ``/segments``, ``..``, ``?query``, or a
    fragment) would otherwise reach unintended upstream endpoints. ``quote``
    leaves ``.`` unescaped, so ``..`` is rejected explicitly.
    """
    v = str(value).strip()
    if (
        not v
        or any(bad in v for bad in ("/", "..", "?", "#"))
        or any(c.isspace() for c in v)
    ):
        raise ValueError(f"invalid identifier: {value!r}")
    return quote(v, safe="")


@server.tool()
async def get_student_risk(student_sis_id: str) -> list[TextContent]:
    """Get a student's advising risk score and early-alert count."""
    sis = _safe_segment(student_sis_id)
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{_base_url()}/api/v1/students/{sis}/risk",
            headers=_auth(),
        )
        data = resp.json()

        result = {
            "student_sis_id": student_sis_id,
            "risk_score": data.get("risk_score"),
            "early_alerts": data.get("early_alerts", 0),
            "last_appointment": data.get("last_appointment"),
            "next_appointment": data.get("next_appointment"),
        }
        return [TextContent(type="text", text=json.dumps(result, indent=2))]


@server.tool()
async def get_appointments(student_sis_id: str) -> list[TextContent]:
    """List a student's advising appointments."""
    sis = _safe_segment(student_sis_id)
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{_base_url()}/api/v1/students/{sis}/appointments",
            headers=_auth(),
            params={"per_page": 50},
        )
        appts = resp.json().get("appointments", [])

        results = [
            {
                "id": a.get("id"),
                "advisor_name": a.get("advisor_name"),
                "scheduled_for": a.get("scheduled_for"),
                "status": a.get("status"),
            }
            for a in appts
        ]
        return [TextContent(type="text", text=json.dumps(results, indent=2))]


if __name__ == "__main__":
    server.run()
