---
name: github
description: GitHub source control and collaboration platform - lets an agent read pull requests, commits, repository metadata, and CI workflow results to support engineering review and documentation.
metadata: {"openclaw":{"requires":{"env":["GITHUB_TOKEN"]}},"primaryEnv":"GITHUB_TOKEN"}
---

# GitHub

## What it is
GitHub is the leading Git hosting and software collaboration platform, used by enterprise engineering teams for source control, code review, and CI/CD orchestration via GitHub Actions. In this segment the engineering agent uses GitHub in read-only mode to fetch pull request diffs, review comments, commit history, and workflow run results to provide code review assistance, generate release notes, and surface build failures.

## When to use this skill
- Reading a pull request diff and review thread to provide feedback or generate a summary
- Fetching the latest GitHub Actions workflow run status for a branch or commit
- Looking up commit history for a repository to understand recent changes
- Retrieving open issues or PR metadata to assess engineering backlog context
- Checking repository topics, language, or contributor stats for onboarding documentation

## Credentials
This skill authenticates using variables from `~/.openclaw/.env` (template: `.env.example` at the config root). Required variables:
- `GITHUB_TOKEN` - personal access token or GitHub App installation token with `repo` and `actions:read` scopes

## Key operations
- `GET /repos/{owner}/{repo}/pulls/{pull_number}` - fetch a pull request with diff metadata
- `GET /repos/{owner}/{repo}/pulls/{pull_number}/reviews` - list review decisions and comments
- `GET /repos/{owner}/{repo}/commits` - list commits on a branch
- `GET /repos/{owner}/{repo}/actions/runs` - list workflow runs
- `GET /repos/{owner}/{repo}/issues?state=open` - list open issues
- `GET /search/issues?q=...` - cross-repo issue and PR search

## Notes
- Use a GitHub App with fine-grained permissions rather than a personal access token in production.
- REST API rate limit is 5,000 requests/hour for authenticated requests; GraphQL counts against the same quota.
- For large diffs, use the `Accept: application/vnd.github.diff` header to get the raw diff.
- Treat code content as confidential; do not log or persist source code outside the secure workspace.
- Enterprise GitHub (GHES) uses a different base URL: `https://github.mycompany.com/api/v3`.
