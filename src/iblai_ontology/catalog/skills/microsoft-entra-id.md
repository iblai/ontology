---
name: microsoft-entra-id
description: Cloud identity platform for government (Microsoft 365 GCC/GCC High); lets agents look up user accounts, check MFA and compliance status, and initiate supervised access provisioning workflows.
metadata: {"openclaw":{"requires":{"env":["ENTRA_TENANT_ID","ENTRA_CLIENT_ID","ENTRA_CLIENT_SECRET","ENTRA_GRAPH_ENDPOINT"]}},"primaryEnv":"ENTRA_CLIENT_SECRET"}
---

# Microsoft Entra ID

## What it is
Microsoft Entra ID (formerly Azure Active Directory) is the cloud identity and access management platform underpinning Microsoft 365 GCC and GCC High environments used by federal and state agencies. It manages user accounts, group memberships, MFA enrollment, conditional access policies, and device compliance, and serves as the identity provider for most agency SaaS applications.

## When to use this skill
- Looking up a user's account status, last sign-in, department, and license assignments during IT support
- Checking MFA enrollment and SSPR registration for a specific user
- Reviewing group memberships and conditional access policy assignments
- Initiating supervised password-reset workflows (requires approval chain)
- Provisioning or deprovisioning accounts as part of onboarding/offboarding workflows

## Credentials
This skill authenticates using variables from the OpenClaw daemon env file `~/.openclaw/.env` (template: `.env.example`). Required variables:
- `ENTRA_TENANT_ID` - Azure AD / Entra tenant ID (GUID)
- `ENTRA_CLIENT_ID` - registered app client ID with appropriate MS Graph permissions
- `ENTRA_CLIENT_SECRET` - registered app client secret
- `ENTRA_GRAPH_ENDPOINT` - Microsoft Graph base URL (GCC High: `https://graph.microsoft.us`; GCC: `https://graph.microsoft.com`)

## Key operations
- `POST /oauth2/v2.0/token` — obtain a client-credentials access token for MS Graph
- `GET /v1.0/users/{userPrincipalName}` — retrieve user profile, account status, and last sign-in
- `GET /v1.0/users/{id}/memberOf` — list group and role memberships
- `GET /v1.0/users/{id}/authentication/methods` — enumerate registered MFA methods
- `GET /v1.0/users/{id}/assignedLicenses` — list Microsoft 365 license assignments
- `POST /v1.0/users/{id}/invalidateAllRefreshTokens` — revoke all sessions (requires User.ReadWrite.All)
- `PATCH /v1.0/users/{id}` — update account properties (requires appropriate write permissions)

## Notes
- GCC High tenants use the `graph.microsoft.us` endpoint and a separate authority (`login.microsoftonline.us`); using the commercial endpoint will fail.
- Write operations (password reset, account enable/disable) require User.ReadWrite.All or a delegated admin role; all writes must go through an approval workflow.
- Conditional access policies and privileged identity management (PIM) roles control what the service account can perform; coordinate with the agency IAM team.
- Audit logs for all read/write operations are retained in Entra ID Sign-in and Audit logs for 30 days by default (extend via Log Analytics integration).
