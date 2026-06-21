# mcp-servers/navigate/server.py
#
# EAB Navigate custom MCP server (advising / student success). Read-only.
# Credential isolation: this process only ever sees Navigate credentials.

from mcp.server import Server
from mcp.types import Tool, TextContent
import httpx
import json
import os

NAVIGATE_BASE_URL = os.environ["NAVIGATE_BASE_URL"]
NAVIGATE_API_KEY = os.environ["NAVIGATE_API_KEY"]

server = Server("navigate-mcp")


@server.tool()
async def get_student_risk(student_sis_id: str) -> list[TextContent]:
    """Get a student's advising risk score and early-alert count."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{NAVIGATE_BASE_URL}/api/v1/students/{student_sis_id}/risk",
            headers={"Authorization": f"Bearer {NAVIGATE_API_KEY}"},
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
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{NAVIGATE_BASE_URL}/api/v1/students/{student_sis_id}/appointments",
            headers={"Authorization": f"Bearer {NAVIGATE_API_KEY}"},
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
