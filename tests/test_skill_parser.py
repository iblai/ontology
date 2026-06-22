"""Tests for SKILL.md ingestion against the real vendored skills."""

from __future__ import annotations

import pytest

from iblai_ontology.catalog.skill_parser import (
    Operation,
    list_vendored,
    load_skill,
    parse_skill,
)

SAMPLE = """\
---
name: demo
description: A demo system.
metadata: {"openclaw":{"requires":{"env":["DEMO_TOKEN","DEMO_BASE_URL"]}},"primaryEnv":"DEMO_TOKEN"}
---

# Demo

## Credentials
- `DEMO_TOKEN` - api token
- `DEMO_BASE_URL` - base url

## Key operations
- `GET /api/v1/things/:id` — read a thing
- `POST /api/v1/things` — create a thing
- `GET /api/v1/things` - list things
"""


def test_parse_frontmatter_and_env():
    seed = parse_skill(SAMPLE)
    assert seed.name == "demo"
    assert seed.description == "A demo system."
    assert seed.env == ["DEMO_TOKEN", "DEMO_BASE_URL"]
    assert seed.primary_env == "DEMO_TOKEN"


def test_parse_operations_and_read_only_filter():
    seed = parse_skill(SAMPLE)
    assert len(seed.operations) == 3
    assert all(isinstance(o, Operation) for o in seed.operations)
    # Only the two GETs are read-only.
    reads = seed.read_operations
    assert len(reads) == 2
    assert all(o.method == "GET" for o in reads)


def test_suggested_tools_are_read_only_by_default():
    seed = parse_skill(SAMPLE)
    tools = seed.suggested_tools()
    assert len(tools) == 2
    names = {t["name"] for t in tools}
    # tool names are slugified from method + path tail
    assert any(n.startswith("get-") for n in names)


def test_all_vendored_skills_parse():
    vendored = list_vendored()
    assert len(vendored) >= 20  # higher-ed + enterprise
    for name in vendored:
        seed = load_skill(name)
        assert seed.env, f"{name} produced no env vars"
        assert seed.operations, f"{name} produced no operations"
        # every vendored skill should expose at least one read-only op
        assert seed.read_operations, f"{name} has no read-only operations"


def test_load_skill_unknown_raises():
    with pytest.raises(FileNotFoundError):
        load_skill("does-not-exist-anywhere")


def test_load_canvas_specifics():
    seed = load_skill("canvas")
    assert "CANVAS_API_TOKEN" in seed.env
    assert any("courses" in o.path for o in seed.operations)
