---
name: okta
description: Okta workforce identity platform - lets an agent verify employee identity, look up user profiles and group memberships, check MFA enrollment status, and support access provisioning workflows.
metadata: {"openclaw":{"requires":{"env":["OKTA_DOMAIN","OKTA_API_TOKEN"]}},"primaryEnv":"OKTA_API_TOKEN"}
---

# Okta

## What it is
Okta is the leading workforce identity and access management (IAM) platform used by enterprise organizations to manage employee authentication, SSO, and application access. In this segment, agents use Okta to verify who an employee is before routing sensitive requests, check application assignment status for IT support, and confirm MFA enrollment during onboarding. It provides the authoritative directory for user identity across the enterprise.

## When to use this skill
- Verifying an employee's identity and role before routing a sensitive HR or IT request
- Looking up a user's group memberships to determine access level or department
- Checking whether a new hire has completed MFA enrollment during onboarding
- Confirming which Okta-managed applications a user is assigned to
- Identifying inactive or locked accounts for IT help desk troubleshooting

## Credentials
This skill authenticates using variables from `~/.openclaw/.env` (template: `.env.example` at the config root). Required variables:
- `OKTA_DOMAIN` - Okta organization domain (e.g. `mycompany.okta.com`)
- `OKTA_API_TOKEN` - API token from the Okta Admin Console (Security > API > Tokens)

## Key operations
- `GET /api/v1/users/{userId}` - retrieve a user profile by ID or login
- `GET /api/v1/users?search=profile.email eq "..."` - find user by email
- `GET /api/v1/users/{userId}/groups` - list groups a user belongs to
- `GET /api/v1/users/{userId}/factors` - list enrolled MFA factors
- `GET /api/v1/apps/{appId}/users` - list users assigned to an application
- `POST /api/v1/users/{userId}/lifecycle/activate` - activate a deprovisioned user

## Notes
- API tokens have the same permissions as the admin who created them; use a dedicated service account.
- Rate limits: 600 requests/minute for most endpoints; Users API is 600/min, Search is 200/min.
- Okta recommends the Events API (or Okta System Log) for audit trail queries rather than polling user endpoints.
- Never expose `OKTA_API_TOKEN` in logs; it grants admin-level read access to the entire directory.
- Okta Preview (sandbox) uses a separate domain; set `OKTA_DOMAIN` to the preview org for non-production testing.
