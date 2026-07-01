---
name: docusign
description: DocuSign e-signature platform; lets an agent send engagement letters and contracts for signature, track envelope status, and retrieve executed documents.
metadata: {"openclaw":{"requires":{"env":["DOCUSIGN_ACCOUNT_ID","DOCUSIGN_INTEGRATION_KEY","DOCUSIGN_USER_ID","DOCUSIGN_PRIVATE_KEY","DOCUSIGN_BASE_URL"]}},"primaryEnv":"DOCUSIGN_PRIVATE_KEY"}
---

# DocuSign

## What it is
DocuSign is the dominant e-signature platform used by law firms to execute engagement letters, retainer agreements, settlement agreements, and contracts. It provides legally binding electronic signatures, a full audit trail, and certificate of completion for every envelope. The DocuSign eSignature REST API supports creating envelopes, routing to multiple signatories, and retrieving signed documents programmatically.

## When to use this skill
- Sending an engagement letter to a new client for signature after intake is complete
- Routing a contract or settlement agreement to all required signatories with defined signing order
- Checking the status of a pending envelope (sent, viewed, signed, declined, voided)
- Retrieving the completed signed PDF and certificate of completion for DMS filing
- Voiding or correcting an envelope that was sent with errors
- Generating a signing URL for embedded signing within a client portal

## Credentials
This skill authenticates using variables declared in the `metadata` frontmatter above. Set them in the OpenClaw daemon env file `~/.openclaw/.env` (see `.env.example` at the config root). Required variables:
- `DOCUSIGN_ACCOUNT_ID` - DocuSign account (API) ID from the admin panel
- `DOCUSIGN_INTEGRATION_KEY` - integration key (client ID) of the API app
- `DOCUSIGN_USER_ID` - GUID of the API service account user
- `DOCUSIGN_PRIVATE_KEY` - RSA private key for JWT grant authentication (PEM format)
- `DOCUSIGN_BASE_URL` - API base URL (e.g., `https://na4.docusign.net/restapi`)

## Key operations
- `POST /v2.1/accounts/{accountId}/envelopes` — create and send an envelope with documents and recipients
- `GET /v2.1/accounts/{accountId}/envelopes/{envelopeId}` — retrieve envelope status and metadata
- `GET /v2.1/accounts/{accountId}/envelopes/{envelopeId}/documents/{documentId}` — download a signed document
- `PUT /v2.1/accounts/{accountId}/envelopes/{envelopeId}` — void or correct a sent envelope
- `POST /v2.1/accounts/{accountId}/envelopes/{envelopeId}/views/recipient` — generate an embedded signing URL
- `GET /v2.1/accounts/{accountId}/envelopes/{envelopeId}/audit_events` — retrieve the full signing audit trail

## Notes
- JWT authentication requires the service account user to grant consent once via the DocuSign OAuth consent URL before automated sending works.
- DocuSign has separate production (`na4.docusign.net`) and demo (`demo.docusign.net`) environments; use demo for testing — never test with real client documents.
- Envelopes in "sent" status cannot be modified; void the envelope and resend if corrections are needed.
- Rate limits: 1,000 API calls per hour per integration key on standard plans; contact DocuSign for higher limits.
- Completed documents must be downloaded within 25 days if the envelope purge policy is enabled on the account.
