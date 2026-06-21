# mcp-servers/canvas/server.py
#
# Canvas LMS custom MCP server. Read-only (GET-only). Exposes a couple of
# student-scoped tools that the sync engine and gateway can call over MCP.
# Credential isolation: this process only ever sees Canvas credentials.

from mcp.server import Server
from mcp.types import Tool, TextContent
import httpx
import json
import os
from datetime import datetime, timedelta

CANVAS_BASE_URL = os.environ["CANVAS_BASE_URL"]
CANVAS_TOKEN = os.environ["CANVAS_API_TOKEN"]

server = Server("canvas-mcp")


@server.tool()
async def get_student_courses(student_sis_id: str) -> list[TextContent]:
    """Get all courses a student is enrolled in for the current term."""
    async with httpx.AsyncClient() as client:
        user_resp = await client.get(
            f"{CANVAS_BASE_URL}/api/v1/users/sis_user_id:{student_sis_id}",
            headers={"Authorization": f"Bearer {CANVAS_TOKEN}"}
        )
        user = user_resp.json()

        enrollments_resp = await client.get(
            f"{CANVAS_BASE_URL}/api/v1/users/{user['id']}/enrollments",
            headers={"Authorization": f"Bearer {CANVAS_TOKEN}"},
            params={
                "state[]": "active",
                "type[]": "StudentEnrollment",
                "per_page": 50
            }
        )
        enrollments = enrollments_resp.json()

        results = []
        for e in enrollments:
            results.append({
                "course_id": e["course_id"],
                "course_name": e.get("course_name", ""),
                "enrollment_state": e["enrollment_state"],
                "current_grade": e.get("grades", {}).get("current_grade"),
                "current_score": e.get("grades", {}).get("current_score"),
                "last_activity_at": e.get("last_activity_at")
            })

        return [TextContent(type="text", text=json.dumps(results, indent=2))]


@server.tool()
async def get_student_submissions(
    student_sis_id: str,
    days_back: int = 7
) -> list[TextContent]:
    """Get a student's recent assignment submissions across all courses."""
    async with httpx.AsyncClient() as client:
        user_resp = await client.get(
            f"{CANVAS_BASE_URL}/api/v1/users/sis_user_id:{student_sis_id}",
            headers={"Authorization": f"Bearer {CANVAS_TOKEN}"}
        )
        user = user_resp.json()

        since = (datetime.utcnow() - timedelta(days=days_back)).isoformat() + "Z"

        submissions_resp = await client.get(
            f"{CANVAS_BASE_URL}/api/v1/users/{user['id']}/submissions",
            headers={"Authorization": f"Bearer {CANVAS_TOKEN}"},
            params={"submitted_since": since, "per_page": 100}
        )
        submissions = submissions_resp.json()

        results = []
        for s in submissions:
            results.append({
                "assignment_id": s["assignment_id"],
                "course_id": s["course_id"],
                "submitted_at": s.get("submitted_at"),
                "score": s.get("score"),
                "grade": s.get("grade"),
                "late": s.get("late", False),
                "missing": s.get("missing", False),
                "workflow_state": s["workflow_state"]
            })

        return [TextContent(type="text", text=json.dumps(results, indent=2))]


if __name__ == "__main__":
    server.run()
