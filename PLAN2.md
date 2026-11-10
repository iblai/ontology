# Ontology roles as RBAC grants, one Ontology Frontend for every platform, and the Access page on both

## Context

The first plan is written and uncommitted in three checkouts: roles as a DM RBAC role carrying a
`metadata` object, schedules and the registry as `OntologyRecord` rows. On 2026-11-11 rei asked for
three changes on top of it:

1. The Ontology Frontend will be hosted once, at `ontology.ibl.ai`, for every platform.
2. A role's ontology permissions are expressed with RBAC resources and permissions; the
   role-metadata model is reversed.
3. The Access page, which edits what each role may reach, is wired to that.

**Stays from the first plan:** `OntologyRecord` and its routes, the store, schedules, the registry,
the README picture, compose, `/counts.data_store`. **Goes:** `RbacRoleMetadata`, migration
`core.0076`, the `metadata` field on a role — in the DM, the ontology and the vibe skills.

| Repo | Checkout | State |
|---|---|---|
| ontology | `~/Projects/ibl.ai/ontology.ibl.ai/main2` | `795fb3a` plus the uncommitted tree of the first plan |
| DM | `~/Projects/ibl.ai/dm/feat-platform-database` | `fff116c8f` plus 26 uncommitted paths, all from the first plan |
| vibe | `~/Projects/ibl.ai/vibe/feat-iblai-api-database` | `f123b765` plus the database skill and the first plan's edits |

Before each DM or vibe step I run `git status` and `git diff` there and stop if a file holds a change
I did not write. Nothing is committed; rei commits.

## Decided by rei on 2026-11-11 (second round)

1. **RBAC home: the DM's custom namespace.** Resources under `/custom/ontology/…`, the ontology's
   own verbs. No DM code for roles.
2. **Find the backend: stored in the platform.** Each backend's address is one ontology record of its
   platform; the frontend reads it with the signed-in user's token.
3. **Tokens: the DM token only.** The backend no longer receives the edX JWT.
4. **The fields that are not access rights** (`display_name`, `agents`, `concurrency_limits`) are one
   ontology record per role.
5. **On the Access page** (said on reviewing this plan) a user can create a role, and edits access
   by clicking a node or the switch in it.
6. **Example roles** (same review) are seeded into the DM at a new platform's first login, so the
   Access page starts with them.
7. **In dm mode `roles.yaml` does not matter**: the roles are in the DM. The example roles live in
   `config/roles.yaml` for `local` mode only.
8. **`ontology roles import <file>` stays, and the file must be named**: no default path.

Standing from earlier today: **no check, test or live run unless rei says so.** Tests are written
with the code; none is run.

## What the code says (read today, nothing run)

- **The DM already has the home.** Core 3.43.0, on `origin/v2`: `/platforms/{pk}/custom/` is reserved
  "to be used by clients for their own purposes"; platform admins hold `*` there through the seeded
  `Custom RBAC Manager` policy (`core/rbac_seeding.py:110-223`). A platform seeded before 3.43.0 has
  it only after `seed_rbac_data` is re-run.
- **A policy resource** is matched by prefix on whole segments, so a parent covers its children
  (`core/rbac_enforcer.py:177-214`). On the wire it is platform-relative. Its characters are
  `[a-zA-Z0-9/_*-]`: no dot, `$` or braces, and `*` is a plain character
  (`core/views/rbac_serializers.py:429-465`). The list comes back sorted; an empty list is accepted.
- **A role's actions** are checked for characters only, never against the registry; `*` matches any
  run of characters (`core/rbac_enforcer.py:156-174`). `Ibl.*` does not cover a verb that does not
  start with `Ibl.`.
- **A policy write may not exceed the caller's own grants** (`core/views/rbac_views.py:527-579`), so
  only someone holding `custom/` can grant an `Ontology/…` verb, and only under `custom/`.
- **A policy** has a name unique in its platform, names its role and carries `resources`; the list
  filters by `name` and `role_id` and embeds `role {id, name, actions}`; deleting a role deletes its
  policies (`core/models/rbac.py:212-232`, `rbac_views.py:471-515`).
- **In the ontology** five things are enforced from a role: memory paths (`fnmatch`,
  `mcp_server/handlers.py:171`), toolsets (`toolsets.py:23-37`), cache tables
  (`handlers.py:268-291`), `admin_dashboard` (`api/auth.py:69`, `handlers.py:163`), `self_service`
  (`handlers.py:343-352`). `agents` and `concurrency_limits` are shown and never enforced. Memory
  files are always `<key>.md` (`sync/writer.py:146`).
- **The Access page** saves every switch as the whole role, `PUT /roles/<name>`
  (`frontend/app/(console)/access/page.tsx:84-102`, `lib/ontology/graph.ts:111-150`), and reads its
  switch states from the `/graph` links. The map page uses the same helper.
- **It cannot create a role, and its nodes do nothing when clicked.** A role is picked only in the
  select above the chart; the switches appear only after that; the one clickable thing in a node is
  a toolset's name (`access/page.tsx:180-226, 233-246, 355-369`). The Roles page has the dialog
  (`components/roles/role-dialog.tsx`).
- **Its cache switch is wrong against a real backend.** It writes the memory domain's name into
  `cache_tables`, while the gateway compares real table names, and a domain's table is whatever its
  schedule says (`graph/builder.py:208-215`): in `config/sync-schedules.yaml` the domain
  `financial-aid` is cached in `financial_aid`, and `students` in `students` and `holds`. The demo
  data hides it, because there a table is named like its domain.
- **The frontend forwards to one backend** (`ONTOLOGY_API_URL`, `app/api/ontology/[...path]/route.ts:9`)
  with three headers and no platform; its Configuration page reads YAML from the frontend's own disk
  (`lib/ontology/config-files.ts`, `ONTOLOGY_ROOT`).
- **The DM answers a user about their own memberships** with the DM token alone:
  `GET /api/core/users/platforms/?username=<self>` (`core/views/user_management.py:131-190`,
  `core/permissions.py:115-151, 238-252`), in the same fields the LMS list has. A DM token carries
  its platform (`core/models/auth.py:33`, still nullable for old tokens).
- **A backend serves one platform.** With `dm`, console admins must be admins of `IBLAI_ORG`
  (`settings.py:262-268`); with `local` and no `ONTOLOGY_ADMIN_PLATFORMS`, any platform's admin
  passes, and the list matches a platform's `key` or its `org` (`api/auth.py:142-148`).
- **The backend's rate limit** counts a console request by client address
  (`backend/ratelimit.py:54-80`): behind one shared frontend every user would share one count.

## How a role is stored

An ontology role is a platform RBAC role that holds an `Ontology/…` verb, plus **one policy, named
`Ontology: <role>`**, with no users or groups. That policy is the only one the ontology reads or
writes. Everything is relative to the platform; the root is `/custom/ontology/`.

| In the role (as in `roles.yaml`) | Policy resource | Verb the role must hold |
|---|---|---|
| `mcp_toolsets: [T]` | `/custom/ontology/toolsets/T/` | `Ontology/Toolsets/action` |
| `mcp_toolsets: ["*"]` | `/custom/ontology/toolsets/` | same |
| `cache_tables: [X]`, `["*"]` | `/custom/ontology/tables/X/`, `/custom/ontology/tables/` | `Ontology/Tables/read` |
| `/ontology/a/b/**` | `/custom/ontology/memory/a/b/` | `Ontology/Memory/read` |
| `/ontology/**` | `/custom/ontology/memory/` | same |
| `/ontology/a/_index.md` (one file) | `/custom/ontology/memory/a/_index*/` | same |
| `${USER_EMPLID}` in a memory path | the segment `USER_EMPLID` | same |
| `admin_dashboard: true` | `/custom/ontology/console/` | `Ontology/Console/action` |
| not `self_service` | `/custom/ontology/subjects/` | `Ontology/Subjects/read` |
| `display_name`, `agents`, `concurrency_limits` | none: an ontology record, kind `role`, key = the role's name | |

- A role the ontology creates carries `actions: ["Ontology/*"]`, so its policy's resources alone say
  what it reaches. A role made by hand with narrower verbs is read honestly: a resource counts only
  if the role holds that kind's verb. The ontology never changes a role's verbs.
- The trailing `*` on a file's last segment stands for its `.md`, which a resource cannot spell.
- `self_service` is the absence of a grant: a role without `/custom/ontology/subjects/` may only read
  its own subject's records. A role made by hand in the platform is self-service until it is granted
  that resource.
- A grant on a parent (`/custom/ontology/`, `/custom/`) means everything beneath, as in the DM.
- **Reading is strict.** Only the shapes in the table count. A resource with a `*` anywhere else, or
  deeper than its kind (`…/toolsets/T/x/`), is skipped and logged, never widened and never an error.
- **Writing refuses, with the reason, what cannot be a resource:** a toolset or table name with a
  character outside letters, digits, `-` and `_`; a memory pattern that is neither a folder (`…/**`
  or `…/*`) nor one `.md` file. Every role in `config/roles.yaml`, the higher-ed example and the
  initializer fits.
- Other policies bound to the role are not read: a policy an admin makes for two users must not
  widen the role for every agent that runs as it. Who holds a role does not change: the Entra
  `roles` claim, or `X-Iblai-Role` on the agent's MCP connection.

### One role end to end: `Executive`

The example role is read from `config/roles.yaml` in `local` mode; in dm mode it is seeded from the
backend's built-in copy and lives in the platform (third column).

| The example role | On the Access page, with the role picked | In the platform (dm) |
|---|---|---|
| `display_name: "University Executive"` | the role node's title and its line in the select | record `role/Executive` |
| `mcp_toolsets: ["*"]` | every toolset node's switch on, dashed lines | `/custom/ontology/toolsets/` |
| `memory_paths: [/ontology/**]` | every memory domain's read switch on, dashed lines | `/custom/ontology/memory/` |
| `cache_tables: ["*"]` | the cache switch on, for every domain that has a table | `/custom/ontology/tables/` |
| `agents: [executive-dashboard-agent]` | an agent node joined to the role by "runs" | record `role/Executive` |
| `concurrency_limits` (the two limits) | not on the page; in the role dialog | record `role/Executive` |
| no `self_service` | not on the page | `/custom/ontology/subjects/` |

The role itself is `Executive` with `actions: ["Ontology/*"]`, and its policy is
`Ontology: Executive`. A toolset added later is covered, since the parent resource is. Switching one
toolset off makes the page send the list of the others, so `/custom/ontology/toolsets/` is replaced
by one resource per remaining toolset; the same for memory and tables.

## Steps

### 1. DM: take the role metadata out

- Restore to `fff116c8f` (each diff read first; all are role metadata only):
  `core/models/rbac.py`, `core/models/__init__.py`, `core/signals/rbac.py`, `core/audit/registry.py`,
  `core/views/rbac_serializers.py`, `core/views/rbac_views.py`, `core/tests/factories.py`,
  `core/tests/test_rbac_views.py`.
- Delete: `core/migrations/0076_rbacrolemetadata.py`, `core/tests/test_rbac_role_metadata.py`,
  `core/utils/schema.py`.
- `ibl_ai_mentor/models/ontology_record.py`: use the probe the app already has
  (`_table_present`, `models/stripe_paywall.py:152`), so core is left with the five
  `Ibl.Mentor/OntologyRecords/*` verbs and nothing else of this work.
- Core, mentor and root `CHANGELOG.md`: drop the `metadata` and audit-actor bullets and
  `core.0076`; core's entry is "no migration" again. No version number changes.

### 2. Ontology: roles from RBAC

- `backend/identity/role_source.py`, the dm half rewritten in place:
  - `_resources(spec)` and `_spec(role, resources)`: the table above in both directions, pure.
  - `load_roles()`: the platform's roles, the policies named `Ontology: …`, and the `role` records.
    An ontology role is a platform role, not internal, one of whose actions matches a verb
    (`fnmatch.fnmatchcase`, the DM's own rule for its character set). A policy counts only when its
    name and its role both match. It stops with the reason if a policy is not of `IBLAI_ORG`.
  - `put_role(name, spec)`: refuses what cannot be stored, a name taken by a platform role that is
    not an ontology role, and a grant whose verb the role does not hold. Creates the role with
    `Ontology/*`, then creates, patches or (when empty) deletes its policy, then writes the record.
    A role this call created is deleted again if its policy cannot be written.
  - `delete_role(name)`: refuses while any other policy binds the role, since the DM would delete
    that one too; otherwise deletes the role (its policy goes with it) and the record.
  - The 60 s cache, the last copy while the platform is down and `RolesUnavailable` stay.
- **Example roles at a platform's first login.** `role_source.seed_once()`, called from the console
  API's entry (`ConsoleAPIView`, `api/views.py:69`) once a signed-in admin is through: if the
  platform has no record `setup/roles` and no ontology role, it writes the example roles, then that
  record. So it happens once per platform, never again after an admin deletes the roles, and a
  platform that already has roles gets only the record. Each process asks the platform once. A role
  that is refused is logged with its reason and the rest are still written; if none could be
  written the record is not written, and the next start tries again. The gateway, the sync engine
  and the CLI never seed.
- **The example roles are built into the backend**, a constant in `role_source.py`: the four of the
  stock `config/roles.yaml` (`default`, `DataAnalyst`, `Executive`, `IblaiOntologyAdmin`). No file
  is read. A test holds the constant equal to the stock file, which stays the example for `local`.
- **`roles.yaml` does not matter in dm mode.** Nothing that runs reads it today: the gateway, the
  console API, the map, the counts, `roles list` and `show`, `config show` all read the platform
  (`role_source.py:46-56, 135-141`, `config/reader.py:74-92`). Two commands still check the file and
  are changed: `ontology roles validate` checks the platform's roles, and `ontology config
  validate` leaves `roles.yaml` and `sync-schedules.yaml` out and says both are in the platform
  (`config/validator.py:74-110`, `commands/roles.py:63-74`). `ontology init` still writes a starter
  file, which dm mode never opens.
- `commands/roles.py` `import <file>`: the path is required, so nothing in dm mode opens
  `config/roles.yaml` on its own; it is the one deliberate way to bring a `local` deployment's roles
  over. A refused role is printed with its reason and the command exits 1 after the rest.
- Unchanged, because the spec keeps the shape `roles.yaml` has: `RoleResolver`, `Permissions`,
  `/roles`, `/graph`, the gateway's checks, `roles list` and `show`.
- Tests, in `tests/conftest.py` (`FakeDm` loses `metadata` and gains the policy routes with the
  DM's rules: characters, sorting, unique name, cascade, a refusal switch) and
  `tests/test_dm_config.py` (roles part rewritten): every stock role round-trips; the refusals;
  strict reading; a parent grant; a verb not held; a second policy ignored on read and refused on
  delete; the cache; create, patch, delete; a failed policy write leaves no role; `roles import`;
  the first console request seeds an empty platform once, a second process and a platform with
  roles write nothing but the record, a refused example does not stop the others; with a
  `roles.yaml` in the config directory that names other roles, nothing in dm mode shows them. The
  `dm` fixture starts with the record present, so the other tests see no seeding.

### 3. Ontology backend: one platform's admins, the DM token only, `/config`, its address

- `backend/api/auth.py`: memberships come from `{ONTOLOGY_DM_URL}/api/core/users/platforms/` with
  the verified username and the same token. `X-Edx-Jwt`, `ONTOLOGY_LMS_URL`, the two-users check and
  the CORS header go (`settings.py`). `tests/test_api.py` auth cases rewritten.
- `settings.py`, `auth.py`: `ONTOLOGY_ADMIN_PLATFORMS` defaults to `IBLAI_ORG` whenever that is set,
  in both store modes, and matches a platform's `key` only. Today a `local` backend reachable from
  the internet takes any platform's admin.
- `backend/ratelimit.py`: a console request whose token the backend has verified is counted per
  token, not per address.
- New `GET /config` (`api/views.py`, `urls.py`, a serializer): the files of the config directory and
  the catalog, secrets masked before they leave the host (the two masking rules of
  `config-files.ts`, which are stricter than the Python ones), without roles and schedules in `dm`.
- `commands/platform.py`, new `address --url <public base URL>`: writes the record
  `backend/default` `{"url": …}`. It refuses a URL that is not `https` (localhost aside).

### 4. Ontology Frontend: every platform

- `app/api/ontology/[...path]/route.ts` and a new `lib/ontology/server/backend.ts`:
  `ONTOLOGY_MULTI_PLATFORM=true` (and no `ONTOLOGY_API_URL`) looks the backend up per request,
  `GET <platform API>/v1/ontology/kinds/backend/records/default` with the caller's `Authorization`.
  The DM ties the platform to the token, so the browser sends no platform key. The answer, a
  refusal included, is kept 60 s per token (its hash). The URL must be `https` and resolve to a
  public address; redirects are not followed. No record is `404 {"error": "no_backend"}`.
- `lib/ontology/api-client.ts` and the route stop sending `X-Edx-Jwt`. The browser keeps the edX
  JWT: the SDK's own calls to the platform need it.
- `components/shell/app-shell.tsx` and a small gate: in this mode a platform with no backend, or a
  member who is not its admin, gets one quiet notice (the existing `EmptyState`) instead of failing
  pages. `app/layout.tsx`: the "Demo data" badge only when neither variable is set.
- Configuration page: the route forwards `/config` in both forwarding modes and passes each file
  through the existing `describe()` (summary, and the mask a second time); `config-files.ts` loses
  its disk reader and `ONTOLOGY_ROOT`.
- `components/navbar/user-profile-button.tsx`: the platform switcher shows for anyone with more than
  one platform, not only for an admin of the current one.
- `frontend/.env.example` (the new variable; `NEXT_PUBLIC_MAIN_TENANT_KEY` stays unset when
  hosted), `messages/en.json` (the only locale here).
- Tests: `lib/ontology/server/backend.test.ts` (lookup, one lookup per token, refusals, relays);
  `routes.test.ts` (the disk-snapshot case goes).

### 5. The Access page

**Create a role, and edit by clicking a node or its switch** (rei, on reviewing this plan), in
`app/(console)/access/page.tsx`:

- **New role.** A "New role" button beside the role select, in the Roles page's quiet style, opens
  the dialog the Roles page uses. `RoleDialog` hands back the role it saved; the page reloads and
  picks it, so its switches are there at once.
- **Click a role node to pick it**, as the select does; click it again for all roles.
- **Click a node to do what its switch does.** A toolset node grants or revokes it for the picked
  role. A memory-domain node flips read; cache keeps its own switch. A tool node goes in or out of
  the picked toolset. With no role picked, a toolset node opens its tools, as its name does today;
  with one picked, the name still does. The switches stay and do the same thing.
- How: the node's main control is stretched over the node in CSS (`after:absolute after:inset-0` on
  its switch or button), the usual stretched-link pattern. There is no click handler on a plain
  element: this app has none and its lint (`jsx-a11y`) would flag one. A drag that starts on such a
  node no longer pans the chart; the gaps and the other nodes still do.
- The hint line under the select says so (`messages/en.json`).

**What a switch becomes.** Each is already one `PUT /roles/<name>`; step 2 turns it into resources
in the role's policy.

| Switch or node | Resource |
|---|---|
| toolset | `/custom/ontology/toolsets/<toolset>/` |
| memory domain, read | `/custom/ontology/memory/<domain>/` |
| memory domain, cache | `/custom/ontology/tables/<table>/` for each of the domain's tables |
| a new role | the role with `Ontology/*`, its policy and its record |

- **The cache switch is fixed** (both store modes, and on the map page, which shares the helper):
  `graph/builder.py` puts each memory domain's cache tables on its node; `lib/ontology/graph.ts`
  grants and revokes those tables, and `*` expands to the real tables. A domain with no cache table
  shows no cache switch. The demo data keeps working: without the list a domain's table is its name.
- The first revoke on a role that has `*` replaces the parent resource by one per name, as the page
  already does in the role. A refusal from the platform arrives as the page's existing error toast.
- Tests, written and not run: `e2e/journeys/05-access.spec.ts` (create a role on the page, pick it
  by its node, grant a toolset by its node, flip read by its switch, reload);
  `lib/ontology/graph.test.ts` (a domain whose tables are named otherwise); the graph case in
  `tests/test_api.py`; and one test that sends the page's own request bodies through the API against
  the fake platform.
- The tool membership switch (`PUT /mcp/toolsets/<name>`) writes `tools.yaml` on the host and is not
  touched.

### 6. vibe

- Restore `skills/users/iblai-api-rbac/SKILL.md`, `skills/users/iblai-vibe-rbac/SKILL.md` and their
  four adapters (the `metadata` lines were their only change).
- `skills/organizations/iblai-api-ontology/SKILL.md`: the role mapping above, the `role` and
  `backend` kinds, what the key needs; then `node scripts/build-adapters.mjs`, which only writes the
  adapters.

### 7. Docs and changelogs

`DEV.md` (the dm section: roles live in the platform and `roles.yaml` is not read; the example
roles at first login; the key: an owner-mode key of a platform admin, on a platform that has the
`Custom RBAC Manager` policy; the hosted frontend), `.env.example`, `README.md`,
`docs/identity.md`, `docs/architecture.md`, `docs/deployment.md`,
`docs/components/{04-mcp-outbound,07-cli}.md`, `CHANGELOG.md`.

### 8. Found on the way: the memory path check

`read-memory` matches the path before `..` is resolved, so
`/ontology/courses/by-dept/../../students/by-id/1.md` passes the `default` role's
`/ontology/courses/by-dept/**` and reads another domain. Fix: normalise the path before the check
(`mcp_server/handlers.py:169-175`, one line), with one test.

### 9. Hand-over

Knowledge-base entries for both rounds under `$KB/ontology.ibl.ai/`, `$KB/dm/` and `$KB/vibe/`, the
index lines in the two `CLAUDE.local.md` files, proposed `CLAUDE.md` lines, and a report of what was
written and what was not run.

## Beyond the three asks (strike any you would rather not have)

Each is small and comes from making one frontend safe for many platforms or the Access page true:
the admin-platform default and `key`-only match (step 3), the rate limit per token (step 3), the
platform switcher for members of several platforms (step 4), the cache switch (step 5), the memory
path check (step 8).

## Left as it is

- Console access for platform users stays "an admin of the backend's platform", not an RBAC verb.
- `local` mode keeps `roles.yaml`. Steps 3, 4, 5 and 8 apply to both modes.
- A platform admin can point their platform's record at any server, which then receives the DM
  tokens of that platform's console users. That is what "the DM token only" accepts.
- A role renamed in the platform loses its policy and reads as granting nothing. A role whose
  `Ontology/…` verb is removed there stops being an ontology role; delete it there to reuse the name.
- A role override made in the DM's admin is not read.
- `ontology sync import` still defaults to the config directory's `sync-schedules.yaml`; say so if
  it should require its file too.
- The service token with `X-Iblai-Role` naming an admin role opens the console API.
- Role writes through the DM's API still carry no actor in its audit log (that change left with the
  metadata).
- PR 3103's `PlatformDatabase` still makes Platform and User deletes fail without `0414`.
- Not checked: whether the platform's own Roles screen keeps `Ontology/*` when it saves such a role.

## Names (say so if you want others)

`/custom/ontology/…`, `Ontology/Toolsets/action`, `Ontology/Tables/read`, `Ontology/Memory/read`,
`Ontology/Console/action`, `Ontology/Subjects/read`, policy `Ontology: <role>`, record kinds `role`,
`backend` and `setup`, `ontology platform address`, `ONTOLOGY_MULTI_PLATFORM`.

## Verification

Nothing below is run until rei says so. Written with the code, for him or a later go-ahead:

```bash
# ontology, in main2 (uv run pytest there runs main's code: use python -m)
uv run python -m pytest -q tests/test_dm_config.py tests/test_api.py tests/test_mcp_gateway.py
uv run ruff format --check . && uv run ruff check .
# Ontology Frontend, in main2/frontend
pnpm typecheck && pnpm lint && pnpm exec vitest run lib/ontology
# DM, in dm/feat-platform-database: what the revert must leave green
./dev.sh test ibl-dm-core-app/core/tests/test_rbac_views.py
./dev.sh test ibl-ai-mentor-app/ibl_ai_mentor/tests/test_ontology_records.py
# vibe, in vibe/feat-iblai-api-database
bash scripts/validate-skills.sh && node scripts/check-skill-kinds.mjs && node scripts/check-links.mjs
```

Only a live run shows: an admin's key creating a policy under `custom/` (and the refusal on a
platform not yet reseeded), the DM accepting `Ontology/*` and a `*` in a resource, a signed-in
user's token reading the `backend` record and their own memberships, and `ontology.ibl.ai` reaching
an on-premise backend. No e2e run covers the hosted mode; the journeys run on the demo data.
