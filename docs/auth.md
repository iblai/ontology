# Authentication: the ibl.ai session, exactly as iblai/os does it

The console issues no tokens and keeps no sessions. It reuses the ibl.ai sign-in that os.ibl.ai
uses, with the same storage keys, the same header schemes and the same refresh path, so a person
signed in to the OS is signed in here. This is the model, taken from `github.com/iblai/os`
(`providers/index.tsx`, `features/utils.ts`, `lib/token-refresh.ts`, `lib/auth-storage.ts`,
`app/sso-login/page.tsx`).

## 1. Sign-in

1. An unauthenticated visit redirects to the auth app:
   `https://<auth host>/login?app=custom&redirect-to=<this origin>&tenant=<platform key>`.
   The auth app is `login.<domain>` (hosted) or whatever `NEXT_PUBLIC_AUTH_URL` points at.
2. The auth app authenticates the person with the organization's SSO (Entra, Google, Shibboleth,
   whatever the tenant configured on ibl.ai) and, through ibl.ai's consolidated-token proxy, mints
   the **app token pair** for that tenant.
3. It returns to this origin at `/sso-login` (the OS route; the Vibe starter calls it
   `/sso-login-complete`) carrying the session. The page is the SDK's `SsoLogin` component; it writes
   the session to storage and continues to the saved `redirect-to` path.

## 2. What is stored, and where

The SDK's per-tab auth storage, mirrored by the app (`lib/auth-storage.ts`):

| Key | Content | Lifetime |
|---|---|---|
| `axd_token`, `axd_token_expires` | token for the analytics/AXD service | short-lived; expiry stored as ISO date |
| `dm_token`, `dm_token_expires` | token for the data-manager service (`…/dm/api/…`, which is where MCP servers, RBAC, api-tokens, org metadata and analytics live) | short-lived |
| `edx_jwt_token` | LMS JWT; **not used by this console** (no LMS calls) | — |
| `userData`, `user_metadata` | the signed-in user and their metadata | session |
| `current_tenant`, `tenant`, `tenants`, `visiting_tenant` | active organization, default organization, memberships | session |

Default is plain `localStorage`. With `NEXT_PUBLIC_IBL_PER_TAB_AUTH=true` the SDK keeps
`sessionStorage` as the per-tab source of truth and `localStorage` as the most-recent-login seed, so
two tabs can sit in two organizations. We keep the default.

Tokens never leave the browser except to ibl.ai and to this host's route handlers over TLS.

## 3. Which header goes to which service

From `features/utils.ts` in the OS:

| Service | Header |
|---|---|
| DM (`config.dmUrl()`, `…/dm/api/…`) | `Authorization: Token <dm_token>` |
| AXD (`config.axdUrl()`) | `Authorization: Token <axd_token>` |
| LMS (`config.lmsUrl()`) | `Authorization: JWT <edx_jwt_token>` |
| anything else | `Authorization: Token <dm_token>` |

Two things follow for this console:

- Every ibl.ai call we make (MCP servers, api-tokens, RBAC, org metadata, analytics) is a DM call,
  so the browser sends `Token <dm_token>` to `https://ext.ibl.ai/dm/api/…`.
- The scheme is `Token`, not `Bearer`. The DM API answers `Bearer` with `401`. Platform API tokens
  (the long-lived ones created under **API** / **Tokens**) use a third scheme, `Api-Token`, and are
  what agents and CLIs present to the gateway. The DM endpoints that manage api-tokens accept only a
  session `Token`, never an `Api-Token`.

## 4. Expiry, refresh, 401

- Before using a token the SDK checks `*_token_expires`. `hasNonExpiredAuthToken()` gates the first
  render.
- On expiry, or on any `401` from ibl.ai, the OS sends the browser to the auth app's
  `/login/complete?redirect-to=<origin>&redirect-path=<current path>&tenant=<key>`
  (`lib/token-refresh.ts`). The auth app re-mints the pair from its own first-party session and
  returns the person to the same page with the session intact. If that session is gone it falls
  through to `/login?logout=1` with the same return address: one sign-in, back where they were.
- Embedded in an iframe (the OS inside another app) it instead posts `authExpired` to the host and
  waits for a fresh payload (`axd_token`, `dm_token`, `tenant`), then replays the failed request.
  The console is not embedded, so it uses the redirect path.
- Logout: clear storage, redirect to `<auth>/logout?redirect-to=<origin>&tenant=<key>`.

## 5. Tenant

`current_tenant` selects the organization. Every DM call carries `platform_key=<tenant key>` (query
or body). The organization switcher in our header is the SDK's tenant switch; switching re-mints
tokens for the new tenant through the same `/login/complete` path. One ontology per tenant follows
from this: the ontology host is configured per organization, and the gateway checks that the
caller's tenant matches the server's.

## 6. How this host verifies a session

Route handlers under `/api/host/*` and the gateway at `/<slug>/mcp` receive either a session token
or a platform token and verify it with ibl.ai before doing anything:

| Presented | Verification |
|---|---|
| `Authorization: Token <dm_token>` (browser, console) | `GET https://ext.ibl.ai/dm/api/core/platform/users/?platform_key=<tenant>&page_size=1` with the same header; a `200` with the caller as an admin of the tenant is a pass. `/api/core/token/verify/` is used where the deployment exposes it. |
| `Authorization: Api-Token <platform token>` (agents, CLIs) | `GET https://ext.ibl.ai/dm/api/core/platform/api-tokens/<name>?platform_key=<tenant>` via the host's own service token to read the token's policies and groups, after a cheap probe call with the presented token confirms it is live. The policies decide the toolset. |
| OIDC ID token (Entra, Google) | not touched by the gateway; forwarded to the runtime, which verifies issuer, audience, signature and expiry itself. |

Verification results are cached in memory for the token's remaining lifetime (minutes), never
persisted. Revoking a token on ibl.ai takes effect at the next cache miss, at most a few minutes.

The host holds one secret of its own for this: a platform **service token** issued on ibl.ai with
the policy that allows reading api-tokens and RBAC for the organization, stored in the host's
environment (`IBLAI_API_KEY`, server-side only, never inlined into the client bundle, as the Vibe
starter's `config.apiKey()` already arranges).

## 7. As implemented in this console

Sign-in is wired with the iblai/vibe starter's provider chain (`/iblai-vibe-auth`), single-organization:

| File | Role |
|---|---|
| `frontend/providers/iblai-providers.tsx` | `initializeDataLayer` → Redux store → `AuthProvider` → `TenantProvider`. Redirects to the auth app when there is no valid session; persists re-minted tokens on organization switch. |
| `frontend/app/(auth)/sso-login-complete/page.tsx` | The SDK `SsoLogin` callback. Lives outside the providers so it can store the tokens before `AuthProvider` checks them. |
| `frontend/lib/iblai/config.ts` | Service URLs. Defaults to the hosted platform; `NEXT_PUBLIC_API_BASE_URL` / `NEXT_PUBLIC_AUTH_URL` point it elsewhere (e.g. `https://ext.ibl.ai`). |
| `frontend/lib/iblai/auth-utils.ts`, `tenant.ts`, `storage-service.ts` | Redirect to the auth app, logout, tenant resolution (`app_tenant` → `NEXT_PUBLIC_MAIN_TENANT_KEY` → `tenant`), the storage adapter the SDK expects. |
| `frontend/lib/iblai/session.tsx` | Reads the stored session (user, email, tenants, `is_admin`) for the shell. Holds the User/Admin switch state. Stores nothing. |
| `frontend/store/iblai-store.ts` | The SDK's RTK Query slices. |

Configuration (`frontend/.env.local`, not committed; template in `.env.example`):

```bash
NEXT_PUBLIC_MAIN_TENANT_KEY=highereducation   # your ibl.ai organization key
# NEXT_PUBLIC_API_BASE_URL=https://ext.ibl.ai  # closed deployment
```

Verified on 2026-11-16: an unauthenticated visit to `http://localhost:3000` redirects to
`https://login.iblai.app/login?app=custom&redirect-to=http://localhost:3000&tenant=highereducation`.
After sign-in the auth app returns to `/sso-login-complete`. **Every origin the console runs on
(`http://localhost:3000`, the deployed hostname) must be on the organization's allowed redirect
origins on ibl.ai**, or the auth app will not return to it.

Access rules in the shell:

- Signed in but not an admin of the organization → an "Administrators only" page. The console
  manages data sources and servers; members have nothing to do here.
- Admins get the OS User/Admin switch. In User mode the admin items in the sidebar footer
  (Invites, Management, API, Secrets, Advanced) and the Billing icon are hidden, as in the OS.

Demo mode: `NEXT_PUBLIC_DEMO=1` skips sign-in and serves a fixed "Demo Admin" session so the UI can
be reviewed and screenshotted without an account. SDK panels (Management, API, Secrets, Advanced,
Billing, Invites, Notifications) then show a sign-in notice instead of calling ibl.ai.
