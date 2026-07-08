# mcp-servers/canvas/server.py
#
# Canvas LMS custom MCP server. Read-only (GET-only). Exposes a couple of
# student-scoped tools that the sync engine and gateway can call over MCP.
# Credential isolation: this process only ever sees Canvas credentials.

import json
import os
from datetime import datetime, timedelta
from urllib.parse import quote

import httpx
from mcp.server.fastmcp import FastMCP
from mcp.types import TextContent

server = FastMCP("canvas-mcp")

_SIS_PREFIXES = ("sis_user_id:", "sis_login_id:")


def _base_url() -> str:
    return os.environ["CANVAS_BASE_URL"]


def _auth() -> dict:
    return {"Authorization": f"Bearer {os.environ['CANVAS_API_TOKEN']}"}


def _safe_segment(value: str) -> str:
    """URL-encode one path segment, rejecting path/route metacharacters.

    ``quote`` leaves ``.`` unescaped, so ``..`` is rejected explicitly rather
    than relied upon being encoded.
    """
    if any(bad in value for bad in ("/", "..", "?", "#")) or any(
        c.isspace() for c in value
    ):
        raise ValueError(f"invalid identifier: {value!r}")
    return quote(value, safe="")


def _user_ref_path(user: str) -> str:
    """Map a user reference to a safe Canvas ``users/:id`` path segment.

    Accepts a **numeric Canvas user id** (e.g. "116") or an explicitly qualified
    SIS reference — ``"sis_user_id:001234567"`` / ``"sis_login_id:jane@x.edu"``.
    The identifier portion is URL-encoded and rejected if it contains path or
    query metacharacters; any other form is rejected. This prevents a crafted
    value from injecting extra path segments or query parameters into the
    upstream request.
    """
    v = str(user).strip()
    if v.isdigit():
        return v
    for prefix in _SIS_PREFIXES:
        if v.startswith(prefix):
            return prefix + _safe_segment(v[len(prefix) :])
    raise ValueError(
        "student must be a numeric Canvas id or a sis_user_id:/sis_login_id: reference"
    )


async def _resolve_user_id(client: httpx.AsyncClient, user: str) -> int:
    """Resolve a user reference to the numeric Canvas user id."""
    resp = await client.get(
        f"{_base_url()}/api/v1/users/{_user_ref_path(user)}", headers=_auth()
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
        resp = await client.get(next_url, headers=_auth(), params=params)
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
            f"{_base_url()}/api/v1/users/{user_id}/enrollments",
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
            f"{_base_url()}/api/v1/users/{user_id}/enrollments",
            {"state[]": "active", "type[]": "StudentEnrollment", "per_page": 100},
        )
        course_ids = [e["course_id"] for e in enrollments]

        results = []
        for course_id in course_ids:
            try:
                submissions = await _get_all(
                    client,
                    f"{_base_url()}/api/v1/courses/{course_id}/students/submissions",
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
