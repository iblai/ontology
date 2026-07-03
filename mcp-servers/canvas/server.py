# mcp-servers/canvas/server.py
#
# Canvas LMS custom MCP server. Read-only (GET-only). Exposes a couple of
# student-scoped tools that the sync engine and gateway can call over MCP.
# Credential isolation: this process only ever sees Canvas credentials.

from mcp.server.fastmcp import FastMCP
from mcp.types import TextContent
import httpx
import json
import os
from datetime import datetime, timedelta

CANVAS_BASE_URL = os.environ["CANVAS_BASE_URL"]
CANVAS_TOKEN = os.environ["CANVAS_API_TOKEN"]

server = FastMCP("canvas-mcp")

_AUTH = {"Authorization": f"Bearer {CANVAS_TOKEN}"}


def _user_ref_path(user: str) -> str:
    """Map a user reference to a Canvas ``users/:id`` path segment.

    Accepts a numeric Canvas user id (``"116"``), an already-qualified
    reference (``"sis_login_id:jane@x.edu"``), or a bare SIS id (mapped to
    ``sis_user_id:``). Instances that don't populate SIS ids can pass the
    Canvas user id directly.
    """
    ref = str(user).strip()
    if ref.isdigit() or ":" in ref:
        return ref
    return f"sis_user_id:{ref}"


async def _resolve_user_id(client: httpx.AsyncClient, user: str) -> int:
    """Resolve a user reference to the numeric Canvas user id."""
    resp = await client.get(
        f"{CANVAS_BASE_URL}/api/v1/users/{_user_ref_path(user)}", headers=_AUTH
    )
    resp.raise_for_status()
    return resp.json()["id"]


@server.tool()
async def get_student_courses(student: str) -> list[TextContent]:
    """Get all courses a student is enrolled in for the current term.

    ``student`` is a Canvas user id (e.g. "116"), a SIS id, or a qualified
    reference such as "sis_login_id:jane@x.edu".
    """
    async with httpx.AsyncClient() as client:
        user_id = await _resolve_user_id(client, student)

        enrollments_resp = await client.get(
            f"{CANVAS_BASE_URL}/api/v1/users/{user_id}/enrollments",
            headers=_AUTH,
            params={
                "state[]": "active",
                "type[]": "StudentEnrollment",
                "per_page": 50
            }
        )
        enrollments_resp.raise_for_status()
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
    student: str,
    days_back: int = 7
) -> list[TextContent]:
    """Get a student's recent assignment submissions across all courses.

    ``student`` is a Canvas user id (e.g. "116"), a SIS id, or a qualified
    reference such as "sis_login_id:jane@x.edu".
    """
    since = (datetime.utcnow() - timedelta(days=days_back)).isoformat() + "Z"
    async with httpx.AsyncClient() as client:
        user_id = await _resolve_user_id(client, student)

        # Canvas has no cross-course user submissions endpoint; the per-course
        # students/submissions endpoint is queried for each active enrollment.
        enrollments_resp = await client.get(
            f"{CANVAS_BASE_URL}/api/v1/users/{user_id}/enrollments",
            headers=_AUTH,
            params={"state[]": "active", "type[]": "StudentEnrollment", "per_page": 100}
        )
        enrollments_resp.raise_for_status()
        course_ids = [e["course_id"] for e in enrollments_resp.json()]

        results = []
        for course_id in course_ids:
            subs_resp = await client.get(
                f"{CANVAS_BASE_URL}/api/v1/courses/{course_id}/students/submissions",
                headers=_AUTH,
                params={
                    "student_ids[]": user_id,
                    "submitted_since": since,
                    "per_page": 100,
                }
            )
            subs_resp.raise_for_status()
            for s in subs_resp.json():
                results.append({
                    "assignment_id": s.get("assignment_id"),
                    "course_id": course_id,
                    "submitted_at": s.get("submitted_at"),
                    "score": s.get("score"),
                    "grade": s.get("grade"),
                    "late": s.get("late", False),
                    "missing": s.get("missing", False),
                    "workflow_state": s.get("workflow_state"),
                })

        return [TextContent(type="text", text=json.dumps(results, indent=2))]


if __name__ == "__main__":
    server.run()
