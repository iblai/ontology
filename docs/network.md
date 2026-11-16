# Network and deployment

The console has two halves: its pages, and its server half (the route handlers under
`/api/host/*`, the MCP gateway, the Toolbox processes and the files under `$ONTOLOGY_HOME`). One
codebase runs them three ways:

| Mode                     | Setting                                 | Behaviour                                                                                                                       |
| ------------------------ | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| One host                 | none                                    | pages and server half on one origin: a developer's machine (`pnpm dev`), or one host inside the institution's network           |
| Pages (hosted on Vercel) | `NEXT_PUBLIC_ONTOLOGY_RELAY=1` at build | serves pages only; every `/api/host/*` call is forwarded to the ontology server the browser names in the `x-ontology-server` header |
| Server (a client's own)  | `ONTOLOGY_SETUP_CODE` in its environment | answers `503` until set up from its installer's link, then serves that one platform only                                        |

The hosted pages are at ontology.iblai.me (staging; ontology.ibl.ai later). A platform's server is
installed on the client's machine with one command ([install.md](install.md)). It needs outbound
access to two things: the ibl.ai backend and the data sources it dissects and serves. Nothing
else.

## Topology

```
  admin's browser ──443──▶ hosted console (Vercel, e.g. ontology.iblai.me)
        │                    pages; /api/host/* forwarded to the server in x-ontology-server
        │ 443                             │ 443, with the admin's ibl.ai sign-in
        ▼                                 ▼
  ibl.ai (sign-in,     ┌────────────────────────────────────────────────────────────────────┐
  platform data)       │  The platform's server  (e.g. ontology.university.edu)             │
                       │                                                                    │
  Claude / Codex /     │  Caddy :443 (TLS, certificate obtained automatically), :80         │
  Cursor ──────443────▶│    /iblai/api/host/*            → server half 127.0.0.1:3000       │
                       │                                    (prefix stripped)               │
  ibl.ai agents ─443──▶│    /iblai/<platform>/<slug>/mcp → gateway, same process            │
  (from ibl.ai egress) │                                    → Toolbox 127.0.0.1:<port>      │
                       │    anything else under /iblai   → 404                              │
                       │    everything else              → NVIDIA's web app 127.0.0.1:3100  │
                       │                                                                    │
                       │  loopback only: engine API 3001, ingestion 3002, Postgres 5434,    │
                       │                 every Toolbox port                                 │
                       │  files: a Docker volume (ONTOLOGY_HOME=/data in the container)     │
                       │           platforms/<platform>/{env, apis.yaml, servers/<slug>/…}  │
                       └──────────┬───────────────────────────┬─────────────────────────────┘
                                  │ 443                       │ db ports
                                  ▼                           ▼
                        ibl.ai backend                data sources
                        ext.ibl.ai (129.80.99.227)    SIS Postgres 5432, LMS MySQL 3306,
                                                       Snowflake 443, CRM Postgres 5432,
                                                       HTTP APIs 443
```

The hosted console keeps nothing and holds no secret. Its pages call the console's own
`/api/host/*` with the admin's ibl.ai sign-in, the platform as `x-ontology-platform` and the
platform's server as `x-ontology-server`. The console forwards each call to
`https://<host>/iblai/api/host/*` with the same sign-in, only to a public https address, following
no redirect, and gives up after 60 seconds. Without the header it answers `404` "No ontology server
is connected for this platform." Its own `/<platform>/<slug>/mcp` answers `404`: agents call the
server.

The browser keeps each platform's server address itself, in
`localStorage["ontology_server:<platform>"]`; the platform has no record of it. The first
administrator gets it by opening the installer's one-time link, `<console>/#host=<host>&code=<code>`,
which sets the server up for the platform they are signed in to. Other administrators connect it by
host name under **Connect a server**.

A server installed from a link serves exactly one platform: the one its link was opened for. Before
setup every `/api/host/*` call and every gateway call answers `503`; after it, another platform gets
`403`. Both refusals come before the server asks ibl.ai anything. `GET /api/host/setup` answers
`{ "set_up": true | false }` without a sign-in, for the installer and the console.

The server half calls only the engine's web app on `127.0.0.1:3100` (`AO_URL`), with the engine's
service key (`AO_API_KEY`, minted by the installer). It never calls ports 3001 or 3002.
`deploy/auto-ontology.override.yml` runs the engine's services on the host's network (a Linux
host), each listening on `127.0.0.1` only, with the web app on 3100 (3000 is the server half's).
The engine then reaches a database on this machine at `127.0.0.1`, the address the runtime uses for
it too. The engine's API trusts its caller's identity header, which is why 3001 and 3002 stay on
loopback. On Docker Desktop (macOS, Windows) host networking behaves differently: publish the ports
on loopback there instead.

On a client's server NVIDIA's own console is reachable at `https://<host>/`, behind its own admin
sign-in; the password is in the server's `.env`. The engine starts with no model: connecting a
database, the map, certifying, raw SQL and certified-term tools work; inferred joins and question
answering wait for a model.

The engine has no notion of platforms, so each platform has its own. On a client's server that is
the server's one engine. On one host, a platform's engine is
`$ONTOLOGY_HOME/platforms/<platform>/engine.json` (`{"url": "...", "key": "..."}`) when the host's
operator wrote one. Otherwise it is the host's own engine (`AO_URL`, `AO_API_KEY`), which serves
exactly one platform: the first whose console admin uses the host, recorded in
`$ONTOLOGY_HOME/engine-platform`. Any other platform gets a `503` saying the host's engine serves
another platform and that the operator connects one by writing its `engine.json`. A host run for
one platform needs nothing more; a host run for several runs one engine stack per platform, each on
its own loopback ports, and one `engine.json` each.

The admin's browser talks to the hosted console and to ibl.ai (`ext.ibl.ai`) directly for sign-in
and platform data, exactly as os.ibl.ai does. So clients need outbound 443 to `ext.ibl.ai` as well.

### One host

Pages and server half run as one Next.js process on `127.0.0.1:3000` behind a TLS proxy (Caddy or
nginx): `/` and `/api/host/*` go to it, and agents call `https://<console host>/<platform>/<slug>/mcp`,
with no `/iblai`. The rest of this document holds, with the console's host in place of the
platform's server.

## Firewall rules

### Inbound to a client's server

| From          | Port | Purpose                                                                                                            | Notes                                                                                                                                                         |
| ------------- | ---- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| internet      | 80   | the certificate's challenge, and the redirect to https                                                             | Caddy obtains and renews the certificate itself                                                                                                               |
| internet      | 443  | `/iblai/api/host/*` from the hosted console, `/iblai/<platform>/<slug>/mcp` from agents, NVIDIA's web app at `/` | the hosted console runs on Vercel and ibl.ai's agents on ibl.ai's egress; neither has an address list you can pin. Every call under `/iblai` but `GET /iblai/api/host/setup` needs an ibl.ai credential; NVIDIA's web app has its own admin sign-in. |
| anything else | —    | denied                                                                                                             |                                                                                                                                                               |

### Inbound to one host on a VPN

| From                    | Port | Purpose                                           | Notes                                                                                                                                                                                                                                                              |
| ----------------------- | ---- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| VPN CIDR(s)             | 443  | console, gateway, playground                      | the only human entry point                                                                                                                                                                                                                                         |
| ibl.ai agent egress IPs | 443  | `/<platform>/<slug>/mcp` calls from ibl.ai agents | **Ask ibl.ai for the current egress list.** The A records below are ingress addresses and may not be the source of outbound agent traffic. Alternative: terminate ibl.ai traffic on the VPN concentrator or a private peering so no public inbound rule is needed. |
| anything else           | —    | denied                                            |                                                                                                                                                                                                                                                                    |

Ports 3000, 3001, 3002, 3100, 5050 (pgAdmin, not started on a client's server), 5434 and every
Toolbox port are bound to loopback and are never published.

### Outbound from the host

| To                                 | Port                                                                                          | Purpose                                                                    | Required by                                                                                                                                                                                                                 |
| ---------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ext.ibl.ai` → 129.80.99.227       | 443                                                                                           | what a caller's credential is granted, checked on every call               | the server half's route handlers and gateway, at `ONTOLOGY_DM_URL` (else the build's `NEXT_PUBLIC_API_BASE_URL`)                                                                                                                                         |
| data source hosts                  | per engine (5432 PostgreSQL, 3306 MySQL, 443 Snowflake and HTTP APIs, ClickHouse's HTTP port) | schema reads, profiling, serving tools, fetching an API's OpenAPI document | auto-ontology, Toolbox, the server half (Fetch Spec)                                                                                                                                                                        |
| model endpoint for dissection      | 443                                                                                           | naming terms, resolving joins, embeddings                                  | auto-ontology. **Decide one of:** a self-hosted NIM inside the network (no outbound), or NVIDIA's hosted endpoint `integrate.api.nvidia.com` (one extra outbound rule). The console does not need it; only the engine does. |
| the certificate authority          | 443                                                                                           | obtaining and renewing the server's certificate                            | Caddy, on a client's server                                                                                                                                                                                                 |
| DNS, NTP, internal CA / OS updates | 53, 123, 443                                                                                  | hygiene                                                                    | host                                                                                                                                                                                                                        |

At install time only: container registries (`nvcr.io`, `docker.io`, `ghcr.io`), GitHub (the
release's files and NVIDIA's source) and Ubuntu's archive on a client's server
([install.md](install.md)); the npm registry on one host (`pnpm install` brings Toolbox as
`@toolbox-sdk/server`). Mirror them internally if the host must stay closed after install, or set
`TOOLBOX_BIN` to a Toolbox binary you supply.

Roles, policies, API keys and agent connections are written on ibl.ai from the admin's browser,
not from the host.

Sign-in: the auth app only returns to origins on the platform's **allowed redirect origins** on
ibl.ai. Add every origin the console's pages are served from there before go-live (the hosted
console's, or the one host's). A client's server serves no pages and is not one of them.

Checked on 2026-11-16: `ext.ibl.ai` does not answer from outside its allow-list (connections from an
unlisted address time out), while the hosted `api.iblai.app` does. Local development therefore uses
the hosted platform; the deployment sets `NEXT_PUBLIC_API_BASE_URL=https://ext.ibl.ai`.

Resolved on 2026-11-15: `ext.ibl.ai` = `129.80.99.227`; the hosted cloud (`api.iblai.app`,
`os.ibl.ai`, `login.iblai.app`) = `141.148.72.26`. Set `NEXT_PUBLIC_API_BASE_URL=https://ext.ibl.ai`
so every ibl.ai call from the browser and from the host uses the backend you allow-listed. A
`NEXT_PUBLIC_*` value is fixed when the image is built, so a client's server takes its ibl.ai
address at run time from `ONTOLOGY_DM_URL`. Pin by hostname at the proxy and by IP at the firewall;
re-check the IP when ibl.ai announces changes.

## What runs where

| Component             | Where                                                       | Listens                                                         | State it keeps                                                                                          |
| --------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Pages                 | Vercel (hosted), or the one host's process                  | the console's origin                                            | none                                                                                                    |
| Forwarding            | the hosted console only                                     | `/api/host/*`, sent on to the server in `x-ontology-server`     | none                                                                                                    |
| Server half           | the client's server (container, host network), or one host | 127.0.0.1:3000 behind the proxy; `/api/host/*`                  | the files below; who a caller is kept in memory for 300 seconds, what they are granted for 60 seconds |
| Gateway               | same process                                                | `/<platform>/<slug>/mcp`, under `/iblai` on a client's server   | `servers/<slug>/gateway.log`                                                                            |
| auto-ontology         | host, one stack per platform                                | web app on 127.0.0.1:3100 (host's own), the rest on loopback    | its Postgres + pgvector volume                                                                          |
| Toolbox               | host, one process per server                                | 127.0.0.1, a free port recorded in `servers/<slug>/flags.json`  | `servers/<slug>/{tools.yaml, flags.json, revisions/, pid, toolbox.log}`, per platform                   |
| Secrets for serving   | host                                                        | —                                                               | the platform's `env`, mode 0600: database passwords and API keys                                        |
| TLS proxy             | host                                                        | 0.0.0.0:443 (and :80 for Caddy)                                 | Caddy's certificate, obtained automatically; on one host on a VPN, a certificate from the internal CA |

`ONTOLOGY_HOME` defaults to `.ontology` in the console's directory. On a client's server it is
`/data` in the container, a Docker volume. Everything in it is kept per platform:

```
$ONTOLOGY_HOME/
  engine-platform                 the platform the host's own engine serves
  platforms/<platform>/
    engine.json                   one host only, optional: this platform's engine, {"url", "key"}
    env                           mode 0600: database passwords and API keys the runtime reads
    apis.yaml, actions.yaml
    servers/<slug>/               tools.yaml, flags.json, revisions/, pid, toolbox.log, gateway.log
```

The folder is the platform's key; a character outside `a-z 0-9 - _` is written as `~<hex>~`. Two
platforms can each have a server named `advising`. On a client's server only setup writes
`engine-platform`.

## Identity on the wire

- Staff in the console: ibl.ai session tokens from `login` (see [auth.md](auth.md)). The browser
  sends them to ibl.ai directly and to the console's route handlers, with the platform as
  `x-ontology-platform`; the handlers ask ibl.ai what they are granted on that platform. On the
  hosted console those calls are forwarded with the same token to the platform's server, so an
  admin's token reaches two places besides ibl.ai: the hosted console, in passing, and their
  platform's own server.
- ibl.ai agents calling a server: the API key stored in the MCP server registered for that agent on
  ibl.ai, sent as `Authorization: Api-Token …`. It must belong to the platform in the server's
  address.
- People using Claude, Codex or Cursor: an API key issued from the console, as `Api-Token` or
  `Bearer`. When the server declares an OIDC auth service, the ID token rides along and Toolbox
  verifies it.
- Neither the hosted console nor the server holds an ibl.ai secret or issues tokens; setting a
  server up mints no key. The server checks each credential by asking ibl.ai with that credential.

## Hardening checklist

- A client's server has a public DNS name and Caddy obtains its certificate. One host on a VPN
  joins no public DNS; its proxy serves an internal-CA certificate.
- The proxy sets `X-Forwarded-Proto: https`. The gateway refuses a credential that arrived over
  plain HTTP from anywhere but loopback.
- Each `$ONTOLOGY_HOME/platforms/<platform>/env` holds database passwords and API keys, mode 0600,
  owned by the user the server half runs as. The engine can keep its own connection credentials in
  Vault if you already run one. Database passwords stay on the platform's server; the hosted
  console holds none.
- NVIDIA's console at `https://<host>/` is protected by its admin password alone. Keep the server's
  `.env` readable by root only.
- Database logins are read-only roles (see [guides/connect-data-sources.md](guides/connect-data-sources.md)).
  Write tools use a separate login and a separate toolset.
- Allowed origins and hosts are set per server. Toolbox receives both as flags but does not refuse
  a foreign `Origin`, so the gateway checks both before it checks the credential.
- Pin the engine's container images by digest; Toolbox is pinned by the lockfile on one host and by
  the image on a client's server.
- Logs: the proxy's access log, `gateway.log` and `toolbox.log` per server, the engine's service
  logs. Ship them to your SIEM from the host.
