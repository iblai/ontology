# Component 4 — MCP Outbound Exposure

> Part of the iblai-ontology architecture. See the [architecture overview](../architecture.md).
>
> The ibl.ai platform integration — registration curl calls, the data model, the in-chat OAuth flow, and the runtime resolution chain — has its own deep dive: **[../platform-integration.md](../platform-integration.md)**.

## Purpose

The on-premise knowledge layer is not a closed system. iblai-ontology exposes *itself* as an MCP server so that authorized external consumers — the ibl.ai agent runtime, university-built applications, third-party MCP tools — can connect and query it. This is the gateway that turns the materialized knowledge (Component 2), scoped by identity (Component 3), into something an agent runtime can actually call.

In this repo the gateway runs as the `ontology-gateway` container, behind a Caddy reverse proxy.

---

## What Gets Exposed

The outbound MCP server exposes, **all scoped by the caller's role**:

1. **All inbound toolsets** from the MCP Toolbox (PeopleSoft queries, cache queries, etc.). A toolset marked `write: true` is exposed only to a role that names it; `"*"` is every toolset that only reads.
2. **The operations of a connected application.** Connecting Twenty CRM adds the toolset `<system>-writes` (`twenty-writes` for a system named `twenty`): create and update for people, companies, opportunities, notes and tasks, ten tools, no delete. The gateway runs them itself with the key the system was connected with; they do not go through the Toolbox ([02-knowledge-materialization.md](02-knowledge-materialization.md#an-application-read-over-its-api)).
3. **Text memory file access** — read-only, restricted to the role's allowed path globs.
4. **Structured cache queries** — `describe-ontology-cache` lists the tables the role may query, each with its columns, and `query-ontology-cache` runs one `SELECT` over them, up to the role's row limit (`max_records_per_query`). Both are offered to a role that may query any table; no toolset has to name them.
5. **Sync status and audit-log queries** — for admin roles only.

`tools/list` gives each tool MCP's `annotations`: `{"readOnlyHint": true}` for a tool that reads, `{"readOnlyHint": false, "destructiveHint": true}` for one that can change data, so a client may ask its user before it calls one. A tool that changes data is recorded in the audit log *before* it runs, with its arguments; if that row cannot be written, the call is refused ([../authorization-model.md](../authorization-model.md#toolsets-that-change-data)).

Inspect what the gateway is serving:

```bash
ontology mcp status      # gateway URL, tool/toolset counts, active sessions
ontology mcp tools       # every exposed tool
ontology mcp toolsets    # toolsets and their members
```

---

## Two-Level Gating

The gateway runs behind an HTTPS reverse proxy (Caddy) on the university's network. Access is gated at two independent levels — either one failing denies the request.

### Level 1 — Network (firewall)

The university's firewall allows inbound HTTPS on port 443 **only** from authorized IP ranges: ibl.ai's infrastructure IPs, and the university's own VPN for remote staff. Everything else is dropped before it reaches the gateway.

A server used from the hosted console (`deploy/install.sh`) cannot have such a list: the hosted console and the ibl.ai platform call from addresses that change. There ports 80 and 443 are open to the internet, 80 only for the certificate and the redirect, and Level 2 guards every call.

### Level 2 — Authentication (Entra ID tokens)

Every MCP request must carry a credential the gateway can verify. The first kind is an Entra ID access token. The gateway validates it — signature via Entra's JWKS, plus `aud`/`iss`/`exp` checks — before executing any tool, then resolves the caller's role from the `X-Iblai-Role` header against `roles.yaml` (with `ONTOLOGY_DATA_STORE=dm`, against the roles kept in the ibl.ai platform; while those cannot be read the gateway answers `503`, never with the `default` role). See [../identity.md](../identity.md) for the full validation logic.

Three other credentials end in the same place, a role:

| `Authorization` | Who | Role |
|---|---|---|
| `Bearer <ONTOLOGY_SERVICE_TOKEN>` | The ibl.ai platform itself | The one `X-Iblai-Role` names |
| `Token <dm_token>` | A member of the platform, with their sign-in token | Every role the platform's policies `Ontology: <role>` list them on, combined |
| `Api-Token <key>` | A platform API key that acts as its owner | As above |
| `Api-Token <key>` | A key limited to its own policies, as the console's Agents page makes for an agent | Exactly the roles attached to the key |

The last three carry their role: the gateway asks the platform what the credential is granted, and answers `400` to an `X-Iblai-Role` sent with one. An administrator's token or key reads everything and changes nothing, unless a role that lists them names a toolset that changes data. A client that can send only `Bearer` may put a DM token or an API key behind it: the gateway works out which it was given. The rules, the statuses and how a person is given a role are in [../identity.md](../identity.md#a-persons-own-iblai-credential).

Because the two levels are independent, a leaked token is useless from an un-allowlisted network, and a connection from an allowlisted IP is still useless without a valid, role-scoped token.

---

## Transport: MCP over `streamable_http`

The gateway speaks MCP over HTTPS using the **`streamable_http`** transport, which works cleanly through the university firewall (it is ordinary HTTPS on 443). This is the transport registered with the ibl.ai platform (`"transport": "streamable_http"`).

A representative platform-to-gateway call (JSON-RPC over the MCP HTTP transport; the `Authorization` header carries the user's Entra ID token, resolved and refreshed automatically by the platform):

```bash
curl -X POST https://ontology.alasu.edu/mcp \
  -H "Authorization: Bearer eyJhbG..." \
  -H "X-Iblai-Role: FinancialAidCounselor" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "method": "tools/call",
    "params": {
      "name": "get-student-enrollment",
      "arguments": {"student_id": "001234567"}
    },
    "id": 1
  }'
```

Response (MCP JSON-RPC format):

```json
{
  "jsonrpc": "2.0",
  "result": {
    "content": [
      { "type": "text",
        "text": "[{\"EMPLID\":\"001234567\",\"cumulative_gpa\":3.42,\"ENRL_STATUS_REASON\":\"ENRL\"}]" }
    ]
  },
  "id": 1
}
```

Text memories are read through a `read-memory` tool, whose path is normalised before the role check (a `..` cannot climb out of a granted folder), and admin roles can call `get-sync-status`. If the caller's role does not allow the requested toolset, memory path, or table, the gateway returns a 403 and logs the denial.

---

## How It Holds Together

- **With Entra ID tokens the gateway never needs to know about the ibl.ai platform.** It only validates the token and resolves roles. Whether a token came from the platform, a university app, or a direct client is irrelevant — the same validation and scoping apply. This is exactly what makes Option B (any MCP client connecting directly) possible later without changing the gateway. Only an ibl.ai credential makes it ask the platform: what that credential is granted, and whose it is.
- **Network isolation backs the trust model.** On the Docker side, only the proxy listens on the host. The gateway and the sync engine bridge the `internal` and `exposed` networks, to reach the platform and the connected systems; the databases, Redis and the MCP Toolbox cannot be reached from outside at all.
- **Scoping is centralized.** Toolset/memory/table access all flow from one place, `roles.yaml` (or with `ONTOLOGY_DATA_STORE=rbac` or `dm` the platform's roles, each with one policy under `/custom/ontology/`), so there is a single place to audit what any role can do.

---

## Related

- The knowledge being exposed: [02-knowledge-materialization.md](02-knowledge-materialization.md)
- Token validation and role resolution: [../identity.md](../identity.md)
- Registering and connecting from the platform: [../platform-integration.md](../platform-integration.md)
- Network topology and the Caddyfile: [../deployment.md](../deployment.md)
- CLI reference for `mcp`: [07-cli.md](07-cli.md)
