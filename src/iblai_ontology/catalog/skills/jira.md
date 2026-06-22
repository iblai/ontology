---
name: jira
description: Jira project and issue tracking - lets an agent create, query, update, and link issues, sprints, and epics across engineering, IT, and operations projects.
metadata: {"openclaw":{"requires":{"env":["JIRA_BASE_URL","JIRA_USER_EMAIL","JIRA_API_TOKEN"]}},"primaryEnv":"JIRA_API_TOKEN"}
---

# Jira

## What it is
Jira by Atlassian is the most widely used issue and project tracking platform in enterprise engineering, IT, and operations teams. In this segment, agents use Jira to link support tickets to engineering bugs, create action items from meeting notes, check sprint progress for engineering advisors, and track operational project milestones. It is also used as the backing store for Jira Service Management (IT help desk) requests.

## When to use this skill
- Creating a bug report or feature request linked to a customer support case
- Adding action items extracted from a meeting as Jira issues with assignees and due dates
- Checking sprint status, velocity, or remaining points for an engineering team
- Querying open issues by component, label, or assignee for a standup summary
- Transitioning an issue status (e.g., In Progress to Done) on behalf of a team member

## Credentials
This skill authenticates using variables from `~/.openclaw/.env` (template: `.env.example` at the config root). Required variables:
- `JIRA_BASE_URL` - base URL of the Jira instance (e.g. `https://mycompany.atlassian.net`)
- `JIRA_USER_EMAIL` - email address of the service account
- `JIRA_API_TOKEN` - API token generated from the Atlassian account portal

## Key operations
- `GET /rest/api/3/issue/{issueIdOrKey}` - retrieve a specific issue
- `POST /rest/api/3/issue` - create a new issue
- `PUT /rest/api/3/issue/{issueIdOrKey}` - update issue fields
- `POST /rest/api/3/issue/{issueIdOrKey}/transitions` - transition issue to a new status
- `GET /rest/api/3/search?jql=...` - run a JQL query to find issues
- `GET /rest/api/3/board/{boardId}/sprint` - list sprints for an agile board

## Notes
- Authentication uses HTTP Basic with email + API token (not password) for cloud instances.
- Server/Data Center instances may use Personal Access Tokens instead of API tokens.
- JQL (Jira Query Language) is the primary filter mechanism; test queries in the Jira UI first.
- Rate limit is 10 requests/second per token for cloud; respect `Retry-After` headers on 429 responses.
- Field IDs (e.g., `customfield_10014` for story points) vary per instance; use `/rest/api/3/field` to discover them.
