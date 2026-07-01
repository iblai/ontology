---
name: pubmed
description: PubMed / NCBI E-utilities — lets an agent search MEDLINE biomedical literature, retrieve structured abstracts, and export citations for clinical research and evidence synthesis tasks.
metadata: {"openclaw":{"requires":{"env":["PUBMED_BASE_URL"]}}}
---

# PubMed / NCBI E-utilities

## What it is
PubMed is the NLM/NCBI index of over 37 million biomedical citations including MEDLINE, life science journals, and online books. The NCBI E-utilities REST API provides programmatic access to search (ESearch), fetch (EFetch), and summarize (ESummary) records. Agents use it to retrieve primary literature evidence for clinical questions, PA appeal support, research synthesis, and evidence-based guideline summaries. An institutional API key raises rate limits significantly above the unauthenticated tier.

## When to use this skill
- Search for clinical evidence supporting or refuting a treatment approach or drug use
- Retrieve abstracts and citation metadata for a set of PMIDs to feed into a systematic review workflow
- Find RCTs or meta-analyses relevant to a specific diagnosis, intervention, or outcome
- Support a prior authorization appeal by surfacing peer-reviewed literature on medical necessity
- Look up pharmacological or safety studies for a drug or device under evaluation

## Credentials
This skill wraps a public API. Copy `~/.openclaw/.env.example` to `~/.openclaw/.env` and optionally set the following variable for increased rate limits:
- `PUBMED_BASE_URL` - E-utilities base URL (`https://eutils.ncbi.nlm.nih.gov/entrez/eutils`)
- `PUBMED_API_KEY` - NCBI API key registered at `ncbi.nlm.nih.gov/account`; raises rate limit to 10 requests/sec (vs. 3/sec unauthenticated) — optional but recommended for production

## Key operations
- `GET /esearch.fcgi?db=pubmed&term={query}&retmax={n}` — search PubMed and return list of PMIDs
- `GET /efetch.fcgi?db=pubmed&id={pmids}&rettype=abstract&retmode=xml` — fetch full abstracts in XML for a list of PMIDs
- `GET /esummary.fcgi?db=pubmed&id={pmids}&retmode=json` — lightweight citation metadata (title, authors, journal, year, DOI)
- `GET /esearch.fcgi?db=pubmed&term={query}&datetype=pdat&mindate={YYYY}&maxdate={YYYY}` — date-range-limited search
- `GET /esearch.fcgi?db=pubmed&term={query}+AND+meta-analysis[pt]` — filter to publication type (meta-analysis, RCT, review)
- `GET /elink.fcgi?dbfrom=pubmed&id={pmid}&cmd=prlinks` — retrieve publisher full-text link for open-access articles

## Notes
- Without an API key, rate limit is 3 requests/sec; always include the `api_key` parameter in production.
- Use MeSH terms (e.g., `Myocardial Infarction[MeSH]`) alongside free-text for higher-precision searches.
- `retmax` defaults to 20; set to 200 for comprehensive searches, then page with `retstart`.
- NCBI E-utilities are a public service; do not use for commercial redistribution of full-text content.
- For systematic reviews, combine PubMed with Embase and Cochrane Library to minimize publication bias.
