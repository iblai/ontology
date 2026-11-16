# Network and deployment

The console and the MCP gateway run on one host inside the institution's network. The host is
reachable only from the internal VPN. It needs outbound access to two things: the ibl.ai backend
and the data sources it dissects and serves. Nothing else.

## Topology

```
                       ┌────────────────────────────────────────────────────────────┐
  staff on VPN ──443──▶│  Ontology host  (e.g. ontology.university.edu)              │
                       │                                                            │
  Claude / Codex /     │  TLS proxy (Caddy or nginx) :443                            │
  Cursor on VPN ─443──▶│    /                → console  (Next.js, 127.0.0.1:3000)   │
                       │    /api/host/*      → console route handlers (stateless)   │
  ibl.ai agents ──443─▶│    /<slug>/mcp      → gateway → Toolbox 127.0.0.1:50xx     │
  (from ibl.ai egress) │                                                            │
                       │  auto-ontology stack (docker, internal network only)       │
                       │    web :3100 · api :3001 · ingestion :3002 · pgvector :5432 │
                       │  Toolbox: one process per server, 127.0.0.1:5001, 5002 …   │
                       │  files: /srv/ontology/servers/<slug>/{tools.yaml,flags,env} │
                       └──────────┬───────────────────────────┬─────────────────────┘
                                  │ 443                       │ db ports
                                  ▼                           ▼
                        ibl.ai backend                data sources
                        ext.ibl.ai (129.80.99.227)    SIS Postgres 5432, LMS MySQL 3306,
                                                       Snowflake 443, CRM Postgres 5432,
                                                       HTTP APIs 443
```

The browser session of a staff member on the VPN talks to two places: this host, and ibl.ai
(`ext.ibl.ai`) directly for sign-in and platform data, exactly as os.ibl.ai does. So VPN clients
need outbound 443 to `ext.ibl.ai` as well.

## Firewall rules

### Inbound to the host

| From | Port | Purpose | Notes |
|---|---|---|---|
| VPN CIDR(s) | 443 | console, gateway, playground | the only human entry point |
| ibl.ai agent egress IPs | 443 | `/<slug>/mcp` calls from ibl.ai agents | **Ask ibl.ai for the current egress list.** The A records below are ingress addresses and may not be the source of outbound agent traffic. Alternative: terminate ibl.ai traffic on the VPN concentrator or a private peering so no public inbound rule is needed. |
| anything else | — | denied | |

Ports 3000, 3001, 3002, 3100, 5432 and 50xx are bound to loopback or the docker network and are
never published.

### Outbound from the host

| To | Port | Purpose | Required by |
|---|---|---|---|
| `ext.ibl.ai` → 129.80.99.227 | 443 | token verification, MCP server registration, platform tokens, RBAC, analytics | console route handlers and gateway |
| data source hosts | per engine (5432 PostgreSQL, 3306 MySQL, 443 Snowflake/BigQuery/HTTP APIs, 1433 SQL Server, 1521 Oracle) | schema reads, profiling, serving tools | auto-ontology and Toolbox |
| model endpoint for dissection | 443 | naming terms, resolving joins, embeddings | auto-ontology. **Decide one of:** a self-hosted NIM inside the network (no outbound), or NVIDIA's hosted endpoint `integrate.api.nvidia.com` (one extra outbound rule). The console does not need it; only the engine does. |
| DNS, NTP, internal CA / OS updates | 53, 123, 443 | hygiene | host |

At install time only: container registries (`nvcr.io`, `docker.io`, `ghcr.io`) and the Toolbox
release download. Mirror them internally if the host must stay closed after install.

Sign-in: the auth app only returns to origins on the organization's **allowed redirect origins**
on ibl.ai. Add the console's internal hostname there before go-live.

Checked on 2026-11-16: `ext.ibl.ai` does not answer from outside its allow-list (connections from an
unlisted address time out), while the hosted `api.iblai.app` does. Local development therefore uses
the hosted platform; the deployment sets `NEXT_PUBLIC_API_BASE_URL=https://ext.ibl.ai`.

Resolved on 2026-11-15: `ext.ibl.ai` = `129.80.99.227`; the hosted cloud (`api.iblai.app`,
`os.ibl.ai`, `login.iblai.app`) = `141.148.72.26`. Set `NEXT_PUBLIC_API_BASE_URL=https://ext.ibl.ai`
so every ibl.ai call from the browser and from the host uses the backend you allow-listed. Pin by
hostname at the proxy and by IP at the firewall; re-check the IP when ibl.ai announces changes.

## What runs where

| Component | Where | Listens | State it keeps |
|---|---|---|---|
| Console (this app) | host, `frontend/` | 127.0.0.1:3000 behind the proxy | none |
| Console route handlers | same process | `/api/host/*` | none; verifies the ibl.ai token per request |
| Gateway | same process | `/<slug>/mcp` | none; origin check, token verification, policy → toolset, forward |
| auto-ontology | host, docker compose | internal only | its Postgres + pgvector volume |
| Toolbox | host, one process per server | 127.0.0.1:5001… | `tools.yaml`, `flags`, `env` under `/srv/ontology/servers/<slug>/` |
| TLS proxy | host | 0.0.0.0:443 | certificate from the internal CA |

## Identity on the wire

- Staff in the console: ibl.ai session tokens from `login` (see [auth.md](auth.md)). The browser
  sends them to ibl.ai directly and to this host's route handlers, which verify them with ibl.ai.
- ibl.ai agents calling a server: the platform token stored in the agent's MCP server connection on
  ibl.ai, sent as `Authorization: Api-Token …`. The gateway verifies it with ibl.ai.
- People using Claude, Codex or Cursor: the same kind of platform token, issued to them on ibl.ai,
  or an Entra ID token when the server declares an OIDC auth service (Toolbox verifies that itself).
- Nothing on this host issues tokens.

## Hardening checklist

- Host joins no public DNS; the proxy serves an internal-CA certificate.
- `/srv/ontology/servers/*/env` holds database credentials, mode 0600, owned by the Toolbox service
  user. auto-ontology can use Vault for its connection store if you already run one.
- Database logins are read-only roles (see [guides/connect-data-sources.md](guides/connect-data-sources.md)).
  Write tools use a separate login and a separate toolset.
- `--allowed-origins` and `--allowed-hosts` are set per server; the gateway enforces the same lists
  before authentication.
- Container images and the Toolbox binary are pinned by digest/version in the compose file.
- Logs: proxy access log, Toolbox stdout per server, auto-ontology service logs. Ship them to your
  SIEM from the host; ibl.ai analytics holds the agent-side record of every tool call.
