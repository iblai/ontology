# Component 1 — MCP Inbound Connectivity

> Part of the iblai-ontology architecture. See the [architecture overview](../architecture.md).

## Purpose

Provide a *uniform* interface to every source system on campus. Instead of building bespoke integrations for each database and API, iblai-ontology uses **MCP (Model Context Protocol)** as the universal connector. Two mechanisms cover every source:

- **Google MCP Toolbox for Databases** — for anything that speaks SQL.
- **Custom MCP servers** — small Docker containers — for API-based systems (Canvas, Slate, Navigate, LDAP).

Every API source ends up behind the same kind of MCP interface, so the sync engine (Component 2) reads it the way the outbound gateway (Component 4) does: a `tools/call`. Database sources are read by the sync engine through their own connection; the Toolbox serves their agent-facing tools.

A custom MCP server that feeds the sync engine exposes one `list-<entity>` tool per entity in the catalog's `sync_defaults` (`list-contacts`, `list-deals`), returning a JSON array of flat objects that carry an `id`; the sync engine creates the cache table from the first row. The server runs stateless streamable HTTP on port 3000 and is reached at `MCP_<NAME>_URL` (`MCP_CANVAS_URL` in the compose stack).

One application needs neither: the backend reads and changes **Twenty CRM** itself, with the address and API key entered when it is connected ([Component 2](02-knowledge-materialization.md#an-application-read-over-its-api)). It is the only API system the console connects without a container on the server.

---

## Google MCP Toolbox for Databases

Handles all direct database connections.

| Source system | Driver / transport | Access posture |
|---|---|---|
| PeopleSoft (Oracle) | JDBC / `oracledb` | Read-only user, SELECT-only grants |
| Ellucian Banner (Oracle) | JDBC / `oracledb` | Read-only user, SELECT-only grants |
| Reporting / data warehouse (PostgreSQL) | direct | Read-only |
| Data warehouse (SQL Server) | `pyodbc` | `db_datareader` only |
| Local iblai-ontology cache (PostgreSQL) | local | Read/write for the sync engine; read-only for the gateway |

The Toolbox runs as a container in the stack (`mcp-toolbox`) on the internal-only network. See [deployment.md](../deployment.md).

---

## MCP Toolbox Configuration: `tools.yaml`

`tools.yaml` is the central configuration file for the Toolbox. It declares three kinds of object:

- **`source`** — a database connection (host, port, credentials, type).
- **`tool`** — a named, parameterized query against a source.
- **`toolset`** — a permission-scoped group of tools that `roles.yaml` (Component 3) can grant to a role.

The canonical, full file lives at `config/tools.yaml`; the discovery/provisioning engines (Components 5 & 6) generate and extend it. The examples below are representative — they show the structure, not every tool.

### Sources

```yaml
# SOURCE: PeopleSoft Oracle Database
kind: source
name: peoplesoft-oracle
type: oracle
host: ${PEOPLESOFT_DB_HOST}
port: ${PEOPLESOFT_DB_PORT}
database: ${PEOPLESOFT_DB_NAME}
user: ${PEOPLESOFT_RO_USER}
password: ${PEOPLESOFT_RO_PASSWORD}

---
# SOURCE: Local iblai-ontology Cache (PostgreSQL)
kind: source
name: ontology-cache
type: postgres
host: ontology-db
port: 5432
database: ontology
user: ${ONTOLOGY_DB_USER}
password: ${ONTOLOGY_DB_PASSWORD}
```

All secrets are interpolated from the environment — `tools.yaml` itself never contains a plaintext password.

### Tools (parameterized queries)

A tool binds a name, a description (which the LLM/agent reads to decide when to call it), typed parameters, and a SQL `statement`. Oracle tools bind positionally (`:1`, `:2`); Postgres tools use `$1`, `$2`.

```yaml
# TOOL: Get student enrollment from PeopleSoft
kind: tool
name: get-student-enrollment
type: oracle-sql
source: peoplesoft-oracle
description: >
  Retrieve a student's current enrollment status, academic program,
  and term details from PeopleSoft. Returns one row per career/term.
parameters:
  - name: student_id
    type: string
    description: The student's EMPLID (e.g., "001234567")
statement: >
  SELECT
    s.EMPLID, s.STRM, s.ACAD_CAREER, s.INSTITUTION,
    s.ACAD_PROG, s.ACAD_PLAN, s.STDNT_CAR_NBR,
    s.UNT_TAKEN_PRGRSS AS credits_attempted,
    s.UNT_EARND_PRGRSS AS credits_earned,
    s.CUR_GPA AS term_gpa, s.CUM_GPA AS cumulative_gpa,
    e.ENRL_STATUS_REASON
  FROM PS_STDNT_CAR_TERM s
  LEFT JOIN PS_STDNT_ENRL e
    ON s.EMPLID = e.EMPLID AND s.STRM = e.STRM
  WHERE s.EMPLID = :1
  ORDER BY s.STRM DESC
```

The full PeopleSoft toolset in `config/tools.yaml` includes (among others): `get-student-holds`, `get-aid-package`, `get-pell-eligibility`, `get-sap-status`, `get-academic-standing`, `get-degree-progress`, and `get-disbursement-schedule`. These follow the same shape — a focused, read-only SELECT keyed by EMPLID (and sometimes aid year). They are summarized here rather than reproduced in full; the file is the source of truth.

Tools that target the **local cache** let agents run aggregations and free-form analytics without touching the live source:

```yaml
# TOOL: Search students in ontology cache
kind: tool
name: search-students
type: postgres-sql
source: ontology-cache
description: >
  Search for students by name, major, classification, or status.
parameters:
  - name: search_term
    type: string
    description: Partial name, major code, or classification
statement: >
  SELECT id, full_name, email, classification, major_code, major_name,
         cumulative_gpa, enrollment_status, has_active_holds, last_synced_at
  FROM students
  WHERE full_name ILIKE '%' || $1 || '%'
     OR major_code ILIKE '%' || $1 || '%'
     OR classification ILIKE '%' || $1 || '%'
     OR id = $1
  ORDER BY full_name
  LIMIT 50
```

A general-purpose `query-ontology-cache` tool accepts a raw SELECT (`statement: ${sql}`) for admin/analytics roles, and `enrollment-summary` returns aggregate term statistics. The `ontology` CLI also enforces read-only at the client layer — `ontology data query` rejects anything that is not a `SELECT`.

### Toolsets (permission-scoped groups)

```yaml
kind: toolset
name: enrollment-tools
tools:
  - get-student-enrollment
  - get-student-holds
  - get-academic-standing
  - get-degree-progress
  - search-students
  - enrollment-summary

---
kind: toolset
name: financial-aid-tools
tools:
  - get-aid-package
  - get-pell-eligibility
  - get-sap-status
  - get-disbursement-schedule

---
kind: toolset
name: student-self-service-tools
tools:
  - get-student-enrollment
  - get-student-holds
  - get-aid-package
  - get-sap-status

---
kind: toolset
name: admin-analytics-tools
tools:
  - query-ontology-cache
  - enrollment-summary
  - search-students
```

`roles.yaml` (Component 3) grants toolsets to roles. The outbound gateway (Component 4) only ever exposes the toolsets the caller's role is allowed to use. You can inspect what is configured with `ontology mcp tools` and `ontology mcp toolsets`.

### Tools that change data

A tool that writes is a named operation, defined like any other tool: one fixed statement, or one HTTP request. It differs in three ways: its own source (the write account), its own toolset marked `write: true`, and a role that names that toolset.

```yaml
# The write account: its own source, so no read tool ever runs on it.
kind: source
name: sis-rw
type: postgres
host: ${SIS_DB_HOST}
port: ${SIS_DB_PORT}
database: ${SIS_DB_NAME}
user: ${SIS_DB_RW_USER}
password: ${SIS_DB_RW_PASSWORD}
---
kind: tool
name: release-hold
type: postgres-sql
source: sis-rw
description: Release one hold, with a note saying why.
parameters:
  - name: hold_id
    type: integer
    description: The hold's id
  - name: note
    type: string
    description: Why it is released
statement: UPDATE holds SET released = true, released_note = $2 WHERE id = $1 RETURNING id, released
---
# An API system, written by hand: the Toolbox's `http` source and tool. The token stays in the Toolbox's env.
kind: source
name: crm
type: http
baseUrl: https://crm.example.edu/api/
headers:
  Authorization: Bearer ${CRM_TOKEN}
---
kind: tool
name: add-note
type: http
source: crm
description: Add a note to a person's record.
method: POST
path: people/{{pathEscape .person}}/notes
headers:
  Content-Type: application/json
requestBody: '{"body": "{{.body}}"}'
pathParams:
  - name: person
    type: string
    description: The person's id
bodyParams:
  - name: body
    type: string
    description: The note
---
kind: toolset
name: registrar-writes
write: true
tools:
  - release-hold
  - add-note
```

- **The gateway decides what writes, not the author** ([authorization-model.md](../authorization-model.md#toolsets-that-change-data)): saving this file with `write: true` left out is refused, naming the tool and why it counts as a write. Put a writing tool on the read source and every tool of that source counts as a write.
- **A role gets the toolset by name**: `mcp_toolsets: [enrollment-tools, registrar-writes]`, or the switch on the console's Access page. `"*"` does not include it.
- **Secrets are references.** A password, a token, an `Authorization` or `Cookie` header, at any depth of a source or a tool, must be `${VAR}` (a scheme word may come first: `Bearer ${VAR}`); a literal is refused on save. The Toolbox reads the values from its own environment (`.env.mcp`).
- **An `http` source on a private address needs saying so.** The Toolbox refuses loopback, private and link-local addresses unless the source lists them (`allowedIpRanges: [10.20.0.0/16]`) or sets `allowPrivateNetworks: true`. An API inside the network is exactly that case.
- **An API is connected in the frontend, not written here.** Add a system → **Custom API** takes its address and its key, and each endpoint named on the system's page becomes one `http` tool that carries `service: <system>`, on the system's own two sources (`<system>-reads`, `<system>-writes`) and in its two toolsets of the same names. Its key is kept encrypted with the system and added to each call by the gateway, as the header parameter the tool declares: it is in no file and in no environment, an agent is never shown that parameter, and it is sent only while the tool's source still has the system's address. See [Install](../install.md#a-system-with-a-web-api).
- **`http` tools written by hand go in the YAML editor** (console → MCP → tools.yaml), with their token in the Toolbox's environment as above. The tool dialog has no method or body fields.
- **A path is resolved against `baseUrl`, and a value is inserted as it is.** When the address has a path of its own, end it with `/` and start the tool's path without one: `/people` under `https://crm.example.edu/api` is refused as leaving the address. Write `{{pathEscape .person}}`, not `{{.person}}`: unescaped, a value such as `7/notes` reaches another endpoint.
- **`${` is the Toolbox's own.** It expands `${NAME}` over its whole file, a description included, and refuses the file when `NAME` is not set.
- The Toolbox does not add a `Content-Type`: set it on the tool, as above.
- Not available: a tool where the agent writes the SQL (`*-execute-sql`). It would count as a write, and it is not a named operation.
- **A connector can ship its operations.** A tool of type `twenty` is generated when Twenty CRM is connected and runs in the gateway, not the Toolbox: `ontology mcp build` leaves it out of the Toolbox's config, and the console's MCP page lists it under its system without an editor. Its toolset, `<system>-writes`, is granted like any other that changes data.

---

## Sample MCP Tool Calls

Any MCP client can load a toolset and call a tool. Using the Python SDK:

```python
from toolbox_core import ToolboxClient

async with ToolboxClient("http://localhost:5000") as client:
    tools = await client.load_toolset("enrollment-tools")
    result = await tools["get-student-enrollment"].call(student_id="001234567")
    print(result)
```

A representative response from `get-student-enrollment`:

```json
[
  {
    "EMPLID": "001234567", "STRM": "2261", "ACAD_CAREER": "UGRD",
    "INSTITUTION": "ALASU", "ACAD_PROG": "BSCS", "ACAD_PLAN": "CS",
    "credits_attempted": 15, "credits_earned": 15,
    "term_gpa": 3.67, "cumulative_gpa": 3.42, "ENRL_STATUS_REASON": "ENRL"
  }
]
```

You can also exercise a single tool from the CLI:

```bash
ontology mcp test get-student-enrollment --params '{"student_id": "001234567"}'
```

---

## Custom MCP Servers for API-Based Systems

Systems that are not databases (Canvas, Slate, Navigate, LDAP) get a lightweight custom MCP server — one Docker container each, exposing a handful of tools over MCP. These live under `mcp-servers/<system>/` and are built by Compose (`mcp-canvas`, `mcp-slate`, `mcp-navigate`, `mcp-ldap`).

### Canvas LMS — example implementation

```python
# mcp-servers/canvas/server.py
from mcp.server.fastmcp import FastMCP
from mcp.types import TextContent
import httpx, json, os
from datetime import datetime, timedelta

CANVAS_BASE_URL = os.environ["CANVAS_BASE_URL"]
CANVAS_TOKEN = os.environ["CANVAS_API_TOKEN"]

server = FastMCP("canvas-mcp")
_AUTH = {"Authorization": f"Bearer {CANVAS_TOKEN}"}


def _user_ref_path(user: str) -> str:
    """A numeric Canvas user id is used directly; an already-qualified ref
    (``sis_login_id:jane@x.edu``) passes through; a bare value is treated as
    ``sis_user_id:``. Instances that don't populate SIS ids pass the Canvas id."""
    ref = str(user).strip()
    return ref if (ref.isdigit() or ":" in ref) else f"sis_user_id:{ref}"


async def _resolve_user_id(client: httpx.AsyncClient, user: str) -> int:
    resp = await client.get(f"{CANVAS_BASE_URL}/api/v1/users/{_user_ref_path(user)}", headers=_AUTH)
    resp.raise_for_status()
    return resp.json()["id"]

@server.tool()
async def get_student_courses(student: str) -> list[TextContent]:
    """Courses a student is enrolled in. `student` is a Canvas user id,
    a SIS id, or a qualified ref like `sis_login_id:jane@x.edu`."""
    async with httpx.AsyncClient() as client:
        user_id = await _resolve_user_id(client, student)

        enrollments = (await client.get(
            f"{CANVAS_BASE_URL}/api/v1/users/{user_id}/enrollments",
            headers=_AUTH,
            params={"state[]": "active", "type[]": "StudentEnrollment", "per_page": 50},
        )).json()
        # ... shape enrollments into results ...
        return [TextContent(type="text", text=json.dumps(results, indent=2))]
```

A second tool, `get_student_submissions(student, days_back=7)`, returns recent submissions with `late` / `missing` flags. Because Canvas has **no cross-course user-submissions endpoint**, it enumerates the student's active enrollments and queries `GET /api/v1/courses/:id/students/submissions?student_ids[]=<uid>` per course. Both tools accept a Canvas user id, a SIS id, or a qualified ref (SIS is used when the instance populates it), are GET-only, call `raise_for_status()` so a bad response never silently corrupts output, and use a single Canvas admin token held only inside the `mcp-canvas` container.

> **Framework note:** custom servers use `FastMCP` (`from mcp.server.fastmcp import FastMCP`), whose `@server.tool()` decorator registers tools. The low-level `mcp.server.Server` class has no `.tool()` decorator.

Representative response from `get_student_courses`:

```json
[
  { "course_id": 45821, "course_name": "CS301 - Data Structures",
    "enrollment_state": "active", "current_grade": "A-",
    "current_score": 91.5, "last_activity_at": "2026-06-19T14:32:00Z" }
]
```

---

## Key Design Decisions

- **Read-only unless defined otherwise.** Every source a sync or a read tool uses has a SELECT-only user; every custom server uses GET-only API calls. Component 5's safety suite proves this before any source is integrated. A change exists only as a named tool on a separate write source, in a toolset marked `write: true` ([above](#tools-that-change-data)).
- **Credential isolation.** Each MCP server has its own credential scope. PeopleSoft credentials live only in the Toolbox's env; Canvas credentials live only in the `mcp-canvas` container. No server can reach another's secrets.
- **No data crosses MCP boundaries.** Each MCP server is a process-isolated container. Data flows *up* to the sync engine and the exposure gateway, never *sideways* between MCP servers.
- **Descriptions are part of the contract.** Each tool's `description` is read by the agent/LLM at call time, so writing precise descriptions is how you make tools discoverable and correctly used.

---

## Related

- Component 2 consumes these tools on a schedule: [02-knowledge-materialization.md](02-knowledge-materialization.md)
- Component 4 exposes these toolsets to the outside, scoped by role: [04-mcp-outbound.md](04-mcp-outbound.md)
- Components 5 & 6 generate and provision `tools.yaml` entries: [05-service-discovery.md](05-service-discovery.md), [06-provisioning.md](06-provisioning.md)
