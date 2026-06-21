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

1. **All inbound toolsets** from the MCP Toolbox (PeopleSoft queries, cache queries, etc.).
2. **Text memory file access** — read-only, restricted to the role's allowed path globs.
3. **Structured cache queries** — restricted to the role's allowed tables.
4. **Sync status and audit-log queries** — for admin roles only.

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

### Level 2 — Authentication (Entra ID tokens)

Every MCP request must carry a valid Entra ID access token. The gateway validates it — signature via Entra's JWKS, plus `aud`/`iss`/`exp` checks — before executing any tool, then resolves the caller's role from the `X-Iblai-Role` header against `roles.yaml`. See [../identity.md](../identity.md) for the full validation logic.

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

Text memories are read through a `read-memory` tool, and admin roles can call `get-sync-status`. If the caller's role does not allow the requested toolset, memory path, or table, the gateway returns a 403 and logs the denial.

---

## How It Holds Together

- **The gateway never needs to know about the ibl.ai platform.** It only validates Entra ID tokens and resolves roles. Whether a token came from the platform, a university app, or a direct client is irrelevant — the same validation and scoping apply. This is exactly what makes Option B (any MCP client connecting directly) possible later without changing the gateway.
- **Network isolation backs the trust model.** On the Docker side, the gateway is the only service (besides the proxy) that bridges the `internal` and `exposed` networks. The databases, MCP Toolbox, and sync engine cannot be reached from outside at all.
- **Scoping is centralized.** Toolset/memory/table access all flow from one file, `roles.yaml`, so there is a single place to audit what any role can do.

---

## Related

- The knowledge being exposed: [02-knowledge-materialization.md](02-knowledge-materialization.md)
- Token validation and role resolution: [../identity.md](../identity.md)
- Registering and connecting from the platform: [../platform-integration.md](../platform-integration.md)
- Network topology and the Caddyfile: [../deployment.md](../deployment.md)
- CLI reference for `mcp`: [07-cli.md](07-cli.md)
