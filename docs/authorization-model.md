# Authorization Model

> How iblai-ontology decides what a caller may access. See also the
> [identity deep-dive](identity.md) and the [architecture overview](architecture.md).

## Summary

Authorization is **role-based**, not per-subject-ownership based. Every request
carries a validated Entra ID JWT (authentication) and a platform-assigned role
(authorization). The gateway resolves *what that role can access* against
`roles.yaml` — toolsets, cache tables, and memory paths — and runs the tool if
the role permits it. The platform's service token and a person's own ibl.ai
credential authenticate the same way and end in the same place, a role; see
[identity.md](identity.md#a-persons-own-iblai-credential).

Each inbound source (PeopleSoft, Canvas, Slate, Navigate, LDAP) is reached with
a **shared per-source service credential**. Credentials are isolated per source,
not per end user. This is intentional: the knowledge layer exists so that staff
agents (financial aid, advising, registrar) can query across many students'
records. "A counselor can look up any student by id" is the designed workflow,
not a flaw — see `identity.md` Step 3 for the canonical example.

## What is *not* enforced (by design)

- **Per-subject ownership on staff/analytics roles.** A role that is granted a
  student toolset may query any subject id within it. Cross-subject access is a
  property of the role grant, governed by which roles the ibl.ai platform
  assigns and by `roles.yaml`, not by comparing the caller to the subject.
- The real control against *unauthorized* cross-subject access is that a caller
  cannot choose their own role: the active role is derived from the validated
  token (see [#2138](https://github.com/iblai/ontology/issues/2138) and
  `roles.py::select_active_role`). Without that, no ownership policy could hold.

## What *is* self-scoped

The **self-service** role class (e.g. `Student` in
`roles.higher-ed.example.yaml`) is the one case with per-user scoping. It is
marked `self_service: true` and is restricted to the caller's own record on
both layers:

- **Memory** — paths are bound to the caller via `${USER_EMPLID}`, substituted
  with the caller's own id from the `IdentityMap` (`roles.py::resolve`). A
  student can only read `/ontology/students/by-id/<their-own-id>.md`.
- **Subject tools** — for a `self_service` role, any subject-identifier argument
  (`SUBJECT_ARG_KEYS` in `handlers.py`: `student_id`, `student`,
  `student_sis_id`, `emplid`) must equal the caller's own subject id, and the
  caller must have a known id (fail-closed). This keeps the tool layer
  consistent with the memory layer — a student cannot read another student's
  enrollment/aid by passing a different `student_id`.

Non-`self_service` roles are unrestricted by this check.

## Toolsets that change data

Out of the box every tool reads. An agent can change a record only through a tool
an administrator defined for that one change, and one rule carries it: **a toolset
that writes is granted by name, never by a wildcard.**

- A toolset is marked `write: true` in `tools.yaml` (the switch "These tools can
  change data" in the console). `mcp_toolsets: ["*"]` is every toolset *without*
  the mark. A role holds a marked one only when it names it, alone or beside the
  wildcard: `["*", "registrar-writes"]`. In the platform that is the resource
  `/custom/ontology/toolsets/registrar-writes/` beside `/custom/ontology/toolsets/`;
  a grant on the root alone never includes a toolset that writes.
- **What counts as a write** (`toolbox_compat.py::writing_tools`) fails closed. A
  tool reads only when the gateway can tell that it does: an `http` tool whose
  method is `GET` or `HEAD`, or a `*-sql` tool with one fixed statement that starts
  with `SELECT`, `WITH`, `SHOW`, `DESCRIBE`, `VALUES` or `TABLE`, holds no `;` and
  no write word (`INSERT`, `UPDATE`, `DELETE`, `MERGE`, `INTO`, `TRUNCATE`, `DROP`,
  `ALTER`, `CREATE`, `GRANT`, `CALL`, `EXEC`, `COPY`, `LOCK`, …). Everything else is
  a write: `*-execute-sql` tools, `templateParameters`, any other type. And **every
  tool on a source one tool writes through is a write**, so a read can never run
  on the write account. It is a text scan, not a parser: a write word inside a
  string makes a read count as a write (the refusal says which word), and a
  function that writes inside a `SELECT` is not seen, which is why a read source
  keeps its read-only account.
- **Three guards, each on its own.** The validator refuses to save a `tools.yaml`
  with a writing tool in an unmarked toolset. The gateway never lends a writing
  tool from an unmarked toolset, whatever the file says (a hand-edited or merged
  file skips the validator). And `tools/list` marks such a tool with MCP's
  `readOnlyHint: false` / `destructiveHint: true`, so a client may ask its user.
- **Nothing runs a write unattended or unrecorded.** A sync schedule cannot name a
  writing tool (refused when saved and when run); the console's Test button and
  `ontology mcp test` refuse one; and the gateway writes the audit row *before* the
  call. If that row cannot be written, the call is not made.

To add one: a second source with the write account's `${VAR}` references, a tool
whose statement is the `UPDATE` (or an `http` tool with `method: POST`), a toolset
with the mark, `ontology mcp build`, a Toolbox restart, then the role's switch on
the Access page. [components/01-mcp-inbound.md](components/01-mcp-inbound.md#tools-that-change-data)
has the YAML.

## Row limit

`concurrency_limits.max_records_per_query` caps what `query-ontology-cache`
returns to the role, whatever `limit` the agent passes. It must be a whole number
above zero; absent is no limit. The console offers 100, 1,000, 10,000 and "No
limit", and a new role starts at 1,000.

## Adding a role

- Staff / analytics / admin role → omit `self_service` (defaults to `false`);
  the role's toolsets and cache tables define its reach.
- A role that must only ever see its own holder's record → set
  `self_service: true` and template memory paths with `${USER_EMPLID}`.

## Audit

Every access, allowed or denied, is written to `audit_log` keyed by the token
`jti` (`middleware.py::write_audit`), so any data access is traceable from login
to the specific tool call. A row's `details` say whether the tool itself failed
(`isError`). A call to a tool that changes data has a second row, written first:
`mcp.tools/call.write`, with the arguments it was given (the first 4,000
characters).
