---
name: cornerstone-ondemand
description: FedRAMP-authorized Learning Management System; lets agents check employee training transcripts, mandatory compliance status, course catalog, and enroll users in required training.
metadata: {"openclaw":{"requires":{"env":["CSOD_BASE_URL","CSOD_CLIENT_ID","CSOD_CLIENT_SECRET","CSOD_CORP_NAME"]}},"primaryEnv":"CSOD_CLIENT_SECRET"}
---

# Cornerstone OnDemand

## What it is
Cornerstone OnDemand is a FedRAMP-authorized Learning Management System (LMS) widely used by federal agencies for mandatory and developmental training management. It tracks employee training transcripts, manages compliance requirements (e.g., annual cybersecurity awareness, ethics, EEO), and hosts blended online and instructor-led course catalogs. It is the primary LMS for many civilian agencies under OPM training policy.

## When to use this skill
- Checking whether a specific employee has completed mandatory training by a given deadline
- Retrieving a training transcript for an employee showing all completions, scores, and certificate URLs
- Querying agency-wide compliance dashboards for overdue mandatory training by org unit
- Browsing the course catalog to identify training relevant to an employee's development goals
- Enrolling an employee in a course or curriculum and notifying their supervisor of the enrollment

## Credentials
This skill authenticates using variables from the OpenClaw daemon env file `~/.openclaw/.env` (template: `.env.example`). Required variables:
- `CSOD_BASE_URL` - Cornerstone tenant base URL (e.g., `https://agency.csod.com`)
- `CSOD_CLIENT_ID` - OAuth 2.0 client ID registered in the Cornerstone API Management console
- `CSOD_CLIENT_SECRET` - OAuth 2.0 client secret
- `CSOD_CORP_NAME` - Cornerstone corporation (tenant) name used in API paths

## Key operations
- `POST /services/api/oauth2/token` — obtain access token using client-credentials flow
- `GET /services/api/x/odata/api/views/vw_rpt_transcript` — query transcript data with OData filters (user, course, status, date range)
- `GET /services/api/x/odata/api/views/vw_rpt_user_comp_status` — retrieve compliance status per user per requirement
- `GET /services/api/x/odata/api/views/vw_rpt_catalog` — browse learning object catalog
- `POST /services/api/x/course/enrollment` — enroll a user in a learning object by user ID and LO ID
- `GET /services/api/x/odata/api/views/vw_rpt_certification` — retrieve certification and credential records

## Notes
- Cornerstone OData endpoints support `$filter`, `$select`, `$top`, and `$skip` for efficient querying; always filter by user or date range to avoid full-table scans.
- FedRAMP-authorized instances are hosted at `*.csod.com`; confirm the agency's specific subdomain with the LMS administrator.
- The `corp_name` value (tenant identifier) is required in most API paths and differs from the subdomain.
- Enrollment operations trigger automated email notifications to learners and supervisors by default; confirm notification settings before bulk enrollments.
- Completion and score data is write-protected via the API; external completions must go through the xAPI/SCORM import pathway.
