<p align="center">
  <a href="https://ibl.ai"><img src="https://ibl.ai/images/iblai-logo.png" alt="ibl.ai" width="300"></a>
</p>

<h1 align="center">iblai-ontology</h1>

<p align="center"><strong>On-premise knowledge layer that makes a university's existing systems queryable by AI agents over MCP — without extracting institutional data to any vendor cloud.</strong></p>

<p align="center">
  <img src="https://img.shields.io/badge/python-3.11+-blue.svg" alt="Python 3.11+">
  <img src="https://img.shields.io/badge/license-MIT-green.svg" alt="License: MIT">
  <img src="https://img.shields.io/badge/protocol-MCP-8A2BE2.svg" alt="MCP">
  <img src="https://img.shields.io/badge/identity-Entra%20ID-0078D4.svg" alt="Microsoft Entra ID">
</p>

---

## What it is

iblai-ontology is a **unified knowledge layer that runs inside the university's network**. It makes existing systems — PeopleSoft/Oracle, Ellucian Banner, Canvas, Slate, EAB Navigate, Workday, LDAP/Active Directory — queryable by AI agents over the **Model Context Protocol (MCP)**.

The prevailing approach in higher-ed AI is to extract institutional data through a VPN tunnel into the vendor's cloud. iblai-ontology does the opposite: **no data extraction, no VPN to our cloud, no third-party infrastructure holding institutional data.** The agent runtime (where models execute) is a separate concern and can run anywhere; the knowledge layer — the data, the cache, the permissions — stays on-premise and is exposed over MCP so any *authorized* runtime can connect.

> **You will have your data, and we may not even have access to it.**

## Architecture

```
UNIVERSITY NETWORK (ON-PREMISE)
  Source systems (PeopleSoft, Canvas, Slate, Navigate, Workday, LDAP)
        │
        ▼  [1] MCP Inbound        Google MCP Toolbox + custom MCP servers
        ▼  [2] Materialization    Text memories (MD) + Postgres cache + vector index
        ▼  [3] Identity           Entra ID JWT validation + roles.yaml (X-Iblai-Role)
        ▼  [4] MCP Outbound       Exposed over HTTPS (streamable_http), scoped by role
        │
        │  HTTPS through the firewall
        ▼
EXTERNAL: Agent runtime (ibl.ai) — forwards the user's Entra token per request,
          never stores institutional data.

OPERATIONS LAYER:  [7] CLI ──▶ [5] Service Discovery ──▶ [6] Provisioning
```

Full diagram and rationale: **[docs/architecture.md](docs/architecture.md)**.

## The seven components

1. **[MCP Inbound Connectivity](docs/components/01-mcp-inbound.md)** — Google MCP Toolbox for databases + custom MCP servers for APIs give every source a uniform MCP interface.
2. **[Knowledge Materialization](docs/components/02-knowledge-materialization.md)** — a sync engine writes Markdown text memories, a PostgreSQL structured cache, and a ChromaDB vector index.
3. **[Identity & Permissions](docs/components/03-identity.md)** — Microsoft Entra ID authenticates every request; the gateway validates the JWT and resolves the caller's role against `roles.yaml`.
4. **[MCP Outbound Exposure](docs/components/04-mcp-outbound.md)** — iblai-ontology is exposed as an MCP server, gated by firewall + Entra tokens, scoped by role.
5. **[Service Discovery Engine](docs/components/05-service-discovery.md)** — a read-only safety suite, schema introspection, BYOK LLM analysis, and pre-built adapters integrate a new source interactively.
6. **[Provisioning Engine](docs/components/06-provisioning.md)** — a 6-step idempotent pipeline turns approved discovery output into a running integration.
7. **[CLI (`ontology`)](docs/components/07-cli.md)** — a comprehensive `typer`-based command surface for every management operation.

## Quick start

```bash
# install (editable, with dev extras)
pip install -e ".[dev]"

# explore the command surface
ontology --help

# initialize a deployment (dirs, config files, docker-compose)
ontology config init
```

`iblai-ontology` is a **hybrid stack**: a lean, Django-free CLI + config layer (works on a fresh checkout) plus a Django + Celery backend for the long-running services (sync, discovery/provisioning, gateway). Install the extras you need:

```bash
pip install -e ".[django]"   # backend services
pip install -e ".[llm]"      # BYOK schema analysis (anthropic / openai)
pip install -e ".[db]"       # source-system drivers (oracle, postgres, mysql, mssql)
pip install -e ".[vector]"   # ChromaDB vector index
```

Names: distribution **`iblai-ontology`** · import package **`iblai_ontology`** · command **`ontology`**.

## CLI command groups

| Group | Commands | Purpose |
|---|---|---|
| `service` | `add` · `list` · `status` · `test` · `discover` · `approve` · `sync` · `remove` | Source-system integrations (discovery + provisioning) |
| `config` | `init` · `show` · `set` · `llm` · `validate` | Configuration management |
| `sync` | `run` · `status` · `history` · `schedule` | Sync operations |
| `roles` | `list` · `show` · `validate` | Role & permission management |
| `health` | `db` · `mcp` · `sync` · `storage` (bare `health` runs all) | Health checks & diagnostics |
| `data` | `query` · `search` · `memory` · `stats` | Query, search, inspect the knowledge layer |
| `deploy` | `up` · `down` · `logs` · `restart` · `status` | Docker Compose lifecycle |
| `mcp` | `status` · `tools` · `toolsets` · `test` | MCP server administration |

```bash
ontology service add                              # interactive integration of a new source
ontology service test peoplesoft                  # 7-test read-only safety suite
ontology config llm                               # configure a BYOK LLM key
ontology sync run                                 # run all due syncs
ontology roles show FinancialAidCounselor
ontology data query "SELECT classification, COUNT(*) FROM students GROUP BY classification"
ontology mcp test get-student-enrollment --params '{"student_id":"001234567"}'
```

Full reference: **[docs/components/07-cli.md](docs/components/07-cli.md)**.

## Documentation

| Document | What it covers |
|---|---|
| [docs/architecture.md](docs/architecture.md) | The full plan: positioning, diagram, seven components, design decisions, phased rollout, open questions |
| [docs/components/01-mcp-inbound.md](docs/components/01-mcp-inbound.md) | Component 1 — `tools.yaml`, custom MCP servers |
| [docs/components/02-knowledge-materialization.md](docs/components/02-knowledge-materialization.md) | Component 2 — sync modes, text memories, Postgres cache, vector index |
| [docs/components/03-identity.md](docs/components/03-identity.md) | Component 3 — summary (pointer to the deep dive) |
| [docs/components/04-mcp-outbound.md](docs/components/04-mcp-outbound.md) | Component 4 — two-level gating, `streamable_http` |
| [docs/components/05-service-discovery.md](docs/components/05-service-discovery.md) | Component 5 — safety suite, introspection, BYOK LLM, adapters |
| [docs/components/06-provisioning.md](docs/components/06-provisioning.md) | Component 6 — the 6-step idempotent pipeline |
| [docs/components/07-cli.md](docs/components/07-cli.md) | Component 7 — full CLI reference |
| [docs/identity.md](docs/identity.md) | Identity deep dive — Entra ID flow, `roles.yaml`, Option A vs. B (RFC 9728 + RFC 7591) |
| [docs/platform-integration.md](docs/platform-integration.md) | ibl.ai platform integration — registration, data model, in-chat OAuth, resolution chain |
| [docs/deployment.md](docs/deployment.md) | Docker Compose stack, networks, Caddyfile, `.env`, phased rollout |

## Security posture

- **Read-only everywhere.** No source-system writes in v1. Before touching any data, the safety suite attempts seven write operations and requires that **all seven be denied** — otherwise it refuses to proceed and prints remediation SQL.
- **Data stays on-prem.** The agent runtime queries data at runtime, scoped by the authenticated user's permissions, and never stores it. The internal Docker network is `internal: true` — databases, MCP Toolbox, and the sync engine cannot reach the internet.
- **Credential isolation.** Each MCP server has its own credential scope; source credentials are encrypted at rest (Fernet).
- **Identity is borrowed, not built.** Microsoft Entra ID authenticates every request; the gateway validates the JWT (signature/aud/iss/exp) and resolves the role against `roles.yaml`. Every access is audited with the token's `jti`.

## License

MIT — see [LICENSE](./LICENSE).
