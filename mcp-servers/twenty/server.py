# mcp-servers/twenty/server.py
#
# Twenty CRM custom MCP server. Read-only (GET-only): one list tool per object the
# catalog syncs, paging the REST API and flattening composite fields the way Twenty
# names its own database columns, so one mapping serves the database and the API path.
# Credential isolation: this process only ever sees the Twenty API key.

import json
import os

import httpx
from mcp.server.fastmcp import FastMCP
from mcp.types import TextContent

# Streamable HTTP on PORT (3000), stateless, so the sync engine's bare tools/call POSTs work.
server = FastMCP(
    "twenty-mcp",
    host="0.0.0.0",
    port=int(os.environ.get("PORT", "3000")),
    stateless_http=True,
    json_response=True,
)

# REST plurals the catalog entry syncs (catalog.yaml `twenty.sync_defaults`).
OBJECTS = (
    "people",
    "companies",
    "opportunities",
    "workspaceMembers",
    "notes",
    "tasks",
    "noteTargets",
    "taskTargets",
)
PAGE = 200  # Twenty's QUERY_MAX_RECORDS
# Field types whose value is an object of sub-fields, stored as one column per sub-field
# (the metadata API names the bodyV2 composite RICH_TEXT; a legacy plain-text value stays as is).
COMPOSITE_TYPES = {
    "FULL_NAME",
    "EMAILS",
    "PHONES",
    "LINKS",
    "ADDRESS",
    "CURRENCY",
    "ACTOR",
    "RICH_TEXT",
    "RICH_TEXT_V2",
}
_composites: dict[str, set[str]] = {}


def _base_url() -> str:
    return os.environ["TWENTY_BASE_URL"].rstrip("/")


def _auth() -> dict:
    return {"Authorization": f"Bearer {os.environ['TWENTY_API_KEY']}"}


def flatten(record: dict, composites: set[str]) -> dict:
    """Composite values as Twenty's columns (name.firstName -> nameFirstName); other JSON stays a value."""
    out = {}
    for key, value in record.items():
        if key in composites and isinstance(value, dict):
            for sub, v in value.items():
                out[f"{key}{sub[:1].upper()}{sub[1:]}"] = v
        else:
            out[key] = value
    return out


async def _composite_fields(client: httpx.AsyncClient, plural: str) -> set[str]:
    """The object's composite field names, from the metadata API once per process."""
    if not _composites:
        resp = await client.get(
            f"{_base_url()}/rest/metadata/objects",
            headers=_auth(),
            params={"limit": PAGE},
        )
        resp.raise_for_status()
        for obj in resp.json()["data"]["objects"]:
            if obj.get("fields") is None:
                raise RuntimeError(
                    f"metadata for {obj.get('namePlural')} carries no fields; composites cannot be flattened"
                )
            _composites[obj["namePlural"]] = {
                f["name"] for f in obj["fields"] if f.get("type") in COMPOSITE_TYPES
            }
    return _composites[plural]


async def _list(plural: str) -> list[dict]:
    """Every record of an object, paged by cursor, composites flattened."""
    rows: list[dict] = []
    async with httpx.AsyncClient(timeout=60) as client:
        composites = await _composite_fields(client, plural)
        params: dict = {"limit": PAGE, "depth": 0}
        while True:
            resp = await client.get(
                f"{_base_url()}/rest/{plural}", headers=_auth(), params=params
            )
            resp.raise_for_status()
            body = resp.json()
            rows.extend(flatten(r, composites) for r in body["data"][plural])
            page = body.get("pageInfo") or {}
            if not page.get("hasNextPage"):
                return rows
            params = {**params, "starting_after": page["endCursor"]}


def _register(plural: str) -> None:
    async def tool() -> list[TextContent]:
        return [
            TextContent(type="text", text=json.dumps(await _list(plural), default=str))
        ]

    server.tool(
        name=f"list-{plural}",
        description=f"List every {plural} record of the workspace, composite fields flattened to column names.",
    )(tool)


for _plural in OBJECTS:
    _register(_plural)


if __name__ == "__main__":
    server.run(transport="streamable-http")
