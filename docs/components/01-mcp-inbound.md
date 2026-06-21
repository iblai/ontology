# Component 1 — MCP Inbound Connectivity

> Part of the iblai-ontology architecture. See the [architecture overview](../architecture.md).

## Purpose

Provide a *uniform* interface to every source system on campus. Instead of building bespoke integrations for each database and API, iblai-ontology uses **MCP (Model Context Protocol)** as the universal connector. Two mechanisms cover every source:

- **Google MCP Toolbox for Databases** — for anything that speaks SQL.
- **Custom MCP servers** — small Docker containers — for API-based systems (Canvas, Slate, Navigate, LDAP).

Every source system ends up behind the same kind of MCP interface, so the sync engine (Component 2) and the outbound gateway (Component 4) only ever speak MCP.

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
from mcp.server import Server
from mcp.types import Tool, TextContent
import httpx, json, os
from datetime import datetime, timedelta

CANVAS_BASE_URL = os.environ["CANVAS_BASE_URL"]
CANVAS_TOKEN = os.environ["CANVAS_API_TOKEN"]

server = Server("canvas-mcp")

@server.tool()
async def get_student_courses(student_sis_id: str) -> list[TextContent]:
    """Get all courses a student is enrolled in for the current term."""
    async with httpx.AsyncClient() as client:
        user = (await client.get(
            f"{CANVAS_BASE_URL}/api/v1/users/sis_user_id:{student_sis_id}",
            headers={"Authorization": f"Bearer {CANVAS_TOKEN}"},
        )).json()

        enrollments = (await client.get(
            f"{CANVAS_BASE_URL}/api/v1/users/{user['id']}/enrollments",
            headers={"Authorization": f"Bearer {CANVAS_TOKEN}"},
            params={"state[]": "active", "type[]": "StudentEnrollment", "per_page": 50},
        )).json()

        results = [{
            "course_id": e["course_id"],
            "course_name": e.get("course_name", ""),
            "enrollment_state": e["enrollment_state"],
            "current_grade": e.get("grades", {}).get("current_grade"),
            "current_score": e.get("grades", {}).get("current_score"),
            "last_activity_at": e.get("last_activity_at"),
        } for e in enrollments]

        return [TextContent(type="text", text=json.dumps(results, indent=2))]
```

A second tool, `get_student_submissions(student_sis_id, days_back=7)`, returns recent assignment submissions across courses with `late` / `missing` flags. Both are GET-only against the Canvas REST API, authenticated with a single Canvas admin token held only inside the `mcp-canvas` container.

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

- **Read-only everywhere.** No source-system writes in v1. Every Toolbox source uses a SELECT-only user; every custom server uses GET-only API calls. Component 5's safety suite proves this before any source is integrated.
- **Credential isolation.** Each MCP server has its own credential scope. PeopleSoft credentials live only in the Toolbox's env; Canvas credentials live only in the `mcp-canvas` container. No server can reach another's secrets.
- **No data crosses MCP boundaries.** Each MCP server is a process-isolated container. Data flows *up* to the sync engine and the exposure gateway, never *sideways* between MCP servers.
- **Descriptions are part of the contract.** Each tool's `description` is read by the agent/LLM at call time, so writing precise descriptions is how you make tools discoverable and correctly used.

---

## Related

- Component 2 consumes these tools on a schedule: [02-knowledge-materialization.md](02-knowledge-materialization.md)
- Component 4 exposes these toolsets to the outside, scoped by role: [04-mcp-outbound.md](04-mcp-outbound.md)
- Components 5 & 6 generate and provision `tools.yaml` entries: [05-service-discovery.md](05-service-discovery.md), [06-provisioning.md](06-provisioning.md)
