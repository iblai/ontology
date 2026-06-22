---
name: slack
description: Slack team messaging platform - lets an agent post messages, send direct messages, read channel history, and deliver notifications into employee workflows.
metadata: {"openclaw":{"requires":{"env":["SLACK_BOT_TOKEN","SLACK_SIGNING_SECRET"]}},"primaryEnv":"SLACK_BOT_TOKEN"}
---

# Slack

## What it is
Slack is the primary team messaging and workflow platform for many enterprise organizations. Agents in this segment use Slack as the delivery channel for responses, meeting summaries, onboarding welcome messages, training reminders, and cross-functional notifications. It is also a source of conversational context when an agent needs to understand what was discussed in a thread or channel.

## When to use this skill
- Posting a meeting recap or action-item summary to a channel or thread
- Sending a direct message to a new hire with onboarding instructions
- Delivering a training deadline reminder or compliance alert to individuals or groups
- Reading recent channel messages to provide context for a follow-up task
- Notifying an IT support requester that their ticket has been resolved

## Credentials
This skill authenticates using variables from `~/.openclaw/.env` (template: `.env.example` at the config root). Required variables:
- `SLACK_BOT_TOKEN` - OAuth bot token starting with `xoxb-`
- `SLACK_SIGNING_SECRET` - used to verify incoming request signatures (if handling events)

## Key operations
- `POST /api/chat.postMessage` - post a message to a channel or DM
- `POST /api/chat.postEphemeral` - send an ephemeral message visible only to one user
- `GET /api/conversations.history?channel=...` - fetch recent messages from a channel
- `GET /api/users.lookupByEmail?email=...` - resolve a user ID from email address
- `POST /api/conversations.open` - open a DM channel with a user
- `POST /api/reactions.add` - add an emoji reaction to a message

## Notes
- Bot must be invited to any channel it needs to post to or read from.
- `conversations.history` requires the `channels:history` or `groups:history` scope depending on channel type.
- Rate limits vary by method tier: Tier 1 = 1 req/min, Tier 3 = 50+ req/min. `chat.postMessage` is Tier 3.
- Avoid storing message content outside the sandbox; treat conversation data as sensitive.
- Use Block Kit for rich formatting (buttons, sections) rather than legacy attachments.
