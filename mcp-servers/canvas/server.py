# mcp-servers/canvas/server.py
#
# Canvas LMS custom MCP server. Read-only (GET-only). Exposes a couple of
# student-scoped tools that the sync engine and gateway can call over MCP.
# Credential isolation: this process only ever sees Canvas credentials.

import json
import os
from datetime import datetime, timedelta

import httpx
from mcp.server.fastmcp import FastMCP
from mcp.types import TextContent

CANVAS_BASE_URL = os.environ["CANVAS_BASE_URL"]
CANVAS_TOKEN = os.environ["CANVAS_API_TOKEN"]

server = FastMCP("canvas-mcp")

_AUTH = {"Authorization": f"Bearer {CANVAS_TOKEN}"}


def _user_ref_path(user: str) -> str:
    """Map a user reference to a Canvas ``users/:id`` path segment.

    A bare value is looked up as a **Canvas user id**. SIS references must be
    explicitly qualified — e.g. ``"sis_user_id:001234567"`` or
    ``"sis_login_id:jane@x.edu"`` — because SIS ids are frequently numeric and
    cannot be reliably distinguished from a Canvas id. A qualified reference is
    already valid Canvas path syntax, so it is passed through unchanged.
    """
    return str(user).strip()


async def _resolve_user_id(client: httpx.AsyncClient, user: str) -> int:
    """Resolve a user reference to the numeric Canvas user id."""
    resp = await client.get(
        f"{CANVAS_BASE_URL}/api/v1/users/{_user_ref_path(user)}", headers=_AUTH
    )
    resp.raise_for_status()
    return resp.json()["id"]


async def _get_all(client: httpx.AsyncClient, url: str, params: dict) -> list:
    """GET a Canvas list endpoint, following ``Link rel="next"`` pagination.

    Raises ``httpx.HTTPStatusError`` on a non-2xx response.
    """
    rows: list = []
    next_url: str | None = url
    while next_url:
        resp = await client.get(next_url, headers=_AUTH, params=params)
        resp.raise_for_status()
        rows.extend(resp.json())
        # The next-page URL already carries the query string.
        next_url = resp.links.get("next", {}).get("url")
        params = None
    return rows


@server.tool()
async def get_student_courses(student: str) -> list[TextContent]:
    """Get all courses a student is enrolled in for the current term.

    ``student``: Canvas user id (e.g. "116"), or a qualified reference such as
    "sis_user_id:001234567" / "sis_login_id:jane@x.edu" (SIS ids must be
    prefixed — they are often numeric and are not auto-detected).
    """
    async with httpx.AsyncClient() as client:
        user_id = await _resolve_user_id(client, student)

        enrollments = await _get_all(
            client,
            f"{CANVAS_BASE_URL}/api/v1/users/{user_id}/enrollments",
            {"state[]": "active", "type[]": "StudentEnrollment", "per_page": 100},
        )

        results = []
        for e in enrollments:
            results.append(
                {
                    "course_id": e["course_id"],
                    "course_name": e.get("course_name", ""),
                    "enrollment_state": e["enrollment_state"],
                    "current_grade": e.get("grades", {}).get("current_grade"),
                    "current_score": e.get("grades", {}).get("current_score"),
                    "last_activity_at": e.get("last_activity_at"),
                }
            )

        return [TextContent(type="text", text=json.dumps(results, indent=2))]


@server.tool()
async def get_student_submissions(
    student: str, days_back: int = 7
) -> list[TextContent]:
    """Get a student's recent assignment submissions across all courses.

    ``student``: Canvas user id (e.g. "116"), or a qualified reference such as
    "sis_user_id:001234567" / "sis_login_id:jane@x.edu" (SIS ids must be
    prefixed — they are often numeric and are not auto-detected).
    """
    since = (datetime.utcnow() - timedelta(days=days_back)).isoformat() + "Z"
    async with httpx.AsyncClient() as client:
        user_id = await _resolve_user_id(client, student)

        # Canvas has no cross-course user submissions endpoint; the per-course
        # students/submissions endpoint is queried for each active enrollment.
        enrollments = await _get_all(
            client,
            f"{CANVAS_BASE_URL}/api/v1/users/{user_id}/enrollments",
            {"state[]": "active", "type[]": "StudentEnrollment", "per_page": 100},
        )
        course_ids = [e["course_id"] for e in enrollments]

        results = []
        for course_id in course_ids:
            try:
                submissions = await _get_all(
                    client,
                    f"{CANVAS_BASE_URL}/api/v1/courses/{course_id}/students/submissions",
                    {
                        "student_ids[]": user_id,
                        "submitted_since": since,
                        "per_page": 100,
                    },
                )
            except httpx.HTTPStatusError:
                # Skip courses this user/token can't read submissions for
                # (e.g. concluded or access-restricted) rather than failing all.
                continue
            for s in submissions:
                results.append(
                    {
                        "assignment_id": s.get("assignment_id"),
                        "course_id": course_id,
                        "submitted_at": s.get("submitted_at"),
                        "score": s.get("score"),
                        "grade": s.get("grade"),
                        "late": s.get("late", False),
                        "missing": s.get("missing", False),
                        "workflow_state": s.get("workflow_state"),
                    }
                )

        return [TextContent(type="text", text=json.dumps(results, indent=2))]


if __name__ == "__main__":
    server.run()
