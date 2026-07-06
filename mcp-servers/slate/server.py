# mcp-servers/slate/server.py
#
# Slate CRM custom MCP server (admissions / recruitment). Read-only (GET-only).
# Credential isolation: this process only ever sees Slate credentials.

import json
import os

import httpx
from mcp.server.fastmcp import FastMCP
from mcp.types import TextContent

SLATE_BASE_URL = os.environ["SLATE_BASE_URL"]
SLATE_API_KEY = os.environ["SLATE_API_KEY"]

server = FastMCP("slate-mcp")


@server.tool()
async def get_application_status(applicant_id: str) -> list[TextContent]:
    """Get the admissions application status for an applicant by Slate ID."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SLATE_BASE_URL}/manage/query/applications",
            headers={"Authorization": f"Bearer {SLATE_API_KEY}"},
            params={"applicant_id": applicant_id},
        )
        data = resp.json()

        result = {
            "applicant_id": applicant_id,
            "status": data.get("status"),
            "decision": data.get("decision"),
            "submitted_at": data.get("submitted_at"),
            "checklist_complete": data.get("checklist_complete"),
        }
        return [TextContent(type="text", text=json.dumps(result, indent=2))]


@server.tool()
async def search_applicants(term: str) -> list[TextContent]:
    """Search prospective applicants by name or email."""
    async with httpx.AsyncClient() as client:
        resp = await client.get(
            f"{SLATE_BASE_URL}/manage/query/people",
            headers={"Authorization": f"Bearer {SLATE_API_KEY}"},
            params={"q": term, "per_page": 50},
        )
        people = resp.json().get("row", [])

        results = [
            {
                "id": p.get("id"),
                "name": p.get("name"),
                "email": p.get("email"),
                "stage": p.get("stage"),
            }
            for p in people
        ]
        return [TextContent(type="text", text=json.dumps(results, indent=2))]


if __name__ == "__main__":
    server.run()
