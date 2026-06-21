# Component 3 — Identity & Permissions (Microsoft Entra ID / SSO)

> Part of the iblai-ontology architecture. See the [architecture overview](../architecture.md).
>
> **This is a pointer page.** The full treatment — the end-to-end Entra ID token flow, `roles.yaml`, `${USER_EMPLID}` resolution, and Option A vs. Option B — lives in the deep dive: **[../identity.md](../identity.md)**.

## Summary

Component 3 is the most critical part of the system. The university's existing SSO — typically **Microsoft Entra ID** (formerly Azure AD), via SAML or OIDC — authenticates *every* request, whether it originates from the ibl.ai agent runtime, a university-built app, or a direct API call. The identity is carried through the entire chain down to individual MCP tool invocations.

The on-premise gateway does **one** authorization job: given a validated identity and a role, it answers *"what can this role access?"* It does **not** decide who has which role.

### The clean three-way split

| Concern | Where it lives | Managed by |
|---|---|---|
| Who is this user? (identity) | Entra ID JWT | University SSO |
| What role does this user have? (role assignment) | ibl.ai platform (Option A — implemented first) | Platform admin |
| What can this role access? (role permissions) | On-premise `roles.yaml` | Ontology deployer |

### Request handling, in brief

1. The agent runtime forwards the user's Entra ID JWT in `Authorization: Bearer …`, plus an `X-Iblai-Role` header set by the ibl.ai platform.
2. The gateway validates the JWT — signature against Entra's JWKS, then `aud`, `iss`, and `exp` checks.
3. It reads `X-Iblai-Role`, resolves the role's permissions in `roles.yaml`, and scopes the response (allowed toolsets, memory-path globs, cache tables).
4. Every access — allowed or denied — is written to the `audit_log` with the token's `jti` for end-to-end traceability.

### Two identity options

- **Option A (implemented first).** The gateway trusts `X-Iblai-Role` because the request carries a valid Entra ID JWT, arrives through the firewall from the platform, and the platform is the authoritative source of role assignment. Lowest on-prem complexity.
- **Option B (roadmap).** iblai-ontology runs its *own* per-user OAuth flow (Notion-style), exposing RFC 9728 Protected Resource Metadata and RFC 7591 Dynamic Client Registration, so any MCP client can connect directly. Both options can coexist.

### Roles

`roles.yaml` defines permissions for the example roles `FinancialAidCounselor`, `AcademicAdvisor`, `Registrar`, `Student`, `Executive`, and `IblaiOntologyAdmin`, plus a `default` fallback for authenticated users with no role assigned. Manage them with:

```bash
ontology roles list
ontology roles show FinancialAidCounselor
ontology roles validate
```

---

**Continue to the deep dive → [../identity.md](../identity.md)**

Related: [04-mcp-outbound.md](04-mcp-outbound.md) (how tokens arrive) and [../platform-integration.md](../platform-integration.md) (how the platform assigns and forwards roles).
