---
name: servicenow
description: ServiceNow ITSM — lets an agent create, update, and resolve IT incidents, search the knowledge base, and check campus service status.
metadata: {"openclaw":{"requires":{"env":["SERVICENOW_CLIENT_ID","SERVICENOW_CLIENT_SECRET","SERVICENOW_BASE_URL"]}},"primaryEnv":"SERVICENOW_CLIENT_ID"}
---

# ServiceNow

## What it is
ServiceNow is the leading IT Service Management (ITSM) platform and is broadly deployed at university IT departments. It manages the full incident and service request lifecycle: ticket creation, routing, knowledge base search, and resolution tracking. The IT help desk agent relies on ServiceNow as its primary action layer for responding to campus technology issues.

## When to use this skill
- Creating a new incident ticket when a student or staff member reports a technology problem
- Searching the knowledge base for self-service resolution steps before escalating
- Updating incident priority or assignment queue based on triage
- Sending automated status updates to users when ticket status changes
- Checking real-time operational status of critical campus services

## Credentials
This skill authenticates using env vars declared in the frontmatter `metadata` field. Set these in `~/.openclaw/.env` (template: `.env.example`):
- `SERVICENOW_BASE_URL` - institution's ServiceNow instance URL (e.g. `https://university.service-now.com`)
- `SERVICENOW_CLIENT_ID` - OAuth 2.0 client ID from ServiceNow OAuth application registry
- `SERVICENOW_CLIENT_SECRET` - OAuth 2.0 client secret

## Key operations
- `POST /api/now/table/incident` — create a new incident record
- `PATCH /api/now/table/incident/:sys_id` — update incident fields (state, priority, assignment group)
- `GET /api/now/table/kb_knowledge?sysparm_query=` — search knowledge base articles
- `GET /api/now/table/incident/:sys_id` — retrieve ticket status and work notes
- `POST /api/now/table/sys_user_notification` — send status update notification to user

## Notes
- ServiceNow uses `sys_id` (UUID) as the primary key for all records; include it in update and resolve calls.
- Respect P1/P2 escalation thresholds: major outages or security incidents must be routed to human IT staff immediately and never resolved autonomously by the agent.
- Knowledge base articles may contain outdated steps after system upgrades; tag low-confidence answers for human review.
- Some institutions restrict the Table API via ACLs; confirm the integration user's role includes `itil_admin` or equivalent.
