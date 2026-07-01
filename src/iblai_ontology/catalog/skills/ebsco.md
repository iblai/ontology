---
name: ebsco
description: EBSCO school databases (EBSCOhost, Explora) — search peer-reviewed articles, reference materials, and grade-leveled nonfiction from school-licensed academic databases.
metadata: {"openclaw":{"requires":{"env":["EBSCO_API_KEY","EBSCO_PROFILE_ID","EBSCO_BASE_URL"]}},"primaryEnv":"EBSCO_API_KEY"}
---

# EBSCO

## What it is
EBSCO Information Services provides the most widely licensed suite of academic databases for K-12 schools, including Explora (elementary and secondary), EBSCOhost, and subject-specific collections. These databases give students access to peer-reviewed journals, magazines, reference books, and primary sources with reading-level filtering and citation metadata.

## When to use this skill
- Searching for credible sources on a research topic appropriate to the student's grade level
- Retrieving full-text articles, encyclopedia entries, or primary source documents for a research assignment
- Filtering results by reading level (Lexile) to match sources to the student's current literacy level
- Generating formatted citations (MLA, APA, Chicago) from article metadata returned by the database
- Verifying source credibility and authority when a student questions whether a source is reliable

## Credentials
This skill authenticates using env vars declared in the frontmatter metadata and provided via `~/.openclaw/.env` (see `.env.example` at the segment root). Required variables:
- `EBSCO_API_KEY` - EBSCOhost API key issued through EBSCO Connect for the district's subscription
- `EBSCO_PROFILE_ID` - database profile ID identifying the licensed databases available to the district
- `EBSCO_BASE_URL` - EBSCOhost API base URL (e.g. `https://eit.ebscohost.com/Services/SearchService.asmx`)

## Key operations
- `POST /Search` — execute a keyword or subject-heading search with reading-level and source-type filters
- `GET /Retrieve` — fetch full record and full text for a specific item by accession number
- `GET /Info` — retrieve available database lists and filter field definitions for the licensed profile
- `POST /ExportFormat` — export citation metadata in MLA, APA, or Chicago format for a given record
- Lexile and reading-level filter parameters: `LN` (Lexile low), `LH` (Lexile high), `RV` (reading level code)

## Notes
- Access is licensed per district; confirm that the target databases are included in the district's EBSCO subscription before querying.
- Full-text availability varies by title and embargo period; some articles return abstract-only even within the licensed profile.
- Never fabricate citations; always derive citation data from actual EBSCO API response metadata.
- IP-authenticated access (without API key) is available on school networks; API key authentication is preferred for agent use.
