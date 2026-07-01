---
name: google-workspace-edu
description: Google Workspace for Education — read and write files in Google Drive, create and edit Docs and Slides, and manage folder structure for K-12 content workflows.
metadata: {"openclaw":{"requires":{"env":["GOOGLE_CLIENT_ID","GOOGLE_CLIENT_SECRET","GOOGLE_REFRESH_TOKEN"]}},"primaryEnv":"GOOGLE_CLIENT_ID"}
---

# Google Workspace for Education

## What it is
Google Workspace for Education (formerly G Suite for Education) is the primary productivity suite for millions of K-12 students and teachers, providing Gmail, Google Drive, Docs, Slides, Sheets, and Forms under a district-managed domain. Agents interact with it via the Google Drive API and Google Docs/Slides APIs to store, retrieve, and edit instructional content.

## When to use this skill
- Saving a generated lesson plan, worksheet, or slide deck to a teacher's designated Drive folder
- Reading a student's submitted Google Doc to provide writing feedback inline via the Docs comment API
- Creating a new Google Slides presentation from a structured outline produced by the content-creation agent
- Organizing exported curriculum materials into shared district or department Drive folders
- Retrieving a list of files in a teacher's course folder to check for existing materials before creating duplicates

## Credentials
This skill authenticates using env vars declared in the frontmatter metadata and provided via `~/.openclaw/.env` (see `.env.example` at the segment root). Required variables:
- `GOOGLE_CLIENT_ID` - OAuth2 client ID from the Google Cloud project (shared with google-classroom skill if same project)
- `GOOGLE_CLIENT_SECRET` - OAuth2 client secret
- `GOOGLE_REFRESH_TOKEN` - long-lived refresh token for the service or teacher account

## Key operations
- `GET /drive/v3/files` — list files and folders with name, MIME type, and parent folder filters
- `POST /drive/v3/files` — create a new file or folder in Drive
- `GET /drive/v3/files/{id}` — retrieve file metadata including sharing settings and owner
- `GET /docs/v1/documents/{documentId}` — read the full content of a Google Doc
- `POST /docs/v1/documents/{documentId}:batchUpdate` — insert inline comments or suggested edits into a Doc
- `POST /slides/v1/presentations` — create a new Google Slides presentation
- `POST /slides/v1/presentations/{id}:batchUpdate` — add or modify slides in an existing presentation

## Notes
- Scopes for Drive, Docs, and Slides are granted separately; request only the scopes required for the current operation.
- Student-owned documents should only be accessed via the submission flow (Google Classroom API) rather than direct Drive access, to respect privacy boundaries.
- Large file exports (e.g., downloading a Slides deck as PPTX) use the Drive `export` endpoint with the appropriate MIME type.
- All files created by agents should be placed in a designated agent-output folder to keep teacher Drive organized.
