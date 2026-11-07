"""Tests for the relationship graph builder (no Django)."""

from __future__ import annotations

from collections import Counter
from types import SimpleNamespace

from iblai_ontology.backend.graph import builder as gb


class _Reader:
    def __init__(self, sources=(), tools=(), toolsets=()):
        self._sources = list(sources)
        self._tools = list(tools)
        self._toolsets = {t["name"]: t for t in toolsets}

    def get_sources(self):
        return self._sources

    def get_tools(self):
        return self._tools

    def get_toolsets(self):
        return self._toolsets


def _service(name="peoplesoft"):
    tables = [
        {
            "schema_name": "SYSADM",
            "table_name": "PS_STDNT_ENRL",
            "row_count": 10,
            "columns": [
                {"name": "EMPLID", "data_type": "VARCHAR2"},
                {"name": "CLASS_NBR"},
            ],
            "foreign_keys": [
                {
                    "column": "EMPLID",
                    "references_table": "PS_STDNT_BIO",
                    "references_column": "EMPLID",
                }
            ],
        },
        {
            "schema_name": "SYSADM",
            "table_name": "PS_STDNT_BIO",
            "row_count": 5,
            "columns": [{"name": "EMPLID"}, {"name": "NAME"}],
        },
        {
            "schema_name": "SYSADM",
            "table_name": "PS_FROM_DATE",
            "row_count": 1,
            "columns": [],
        },
    ]
    llm = {
        "table_descriptions": [
            {
                "table_name": "SYSADM.PS_STDNT_ENRL",
                "entity_group": "enrollment",
                "description": "x",
            },
            {
                "table_name": "SYSADM.PS_STDNT_BIO",
                "entity_group": "students",
                "description": "y",
            },
        ],
        "entity_groups": {
            "enrollment": ["PS_STDNT_ENRL"],
            "students": ["PS_STDNT_BIO"],
        },
    }
    return SimpleNamespace(
        name=name,
        display_name="PeopleSoft",
        adapter="peoplesoft",
        status="active",
        schema_manifest={"tables": tables},
        llm_analysis=llm,
    )


READER = _Reader(
    sources=[
        {"kind": "source", "name": "peoplesoft-source", "type": "oracle", "host": "db"},
        {"kind": "source", "name": "ontology-cache", "type": "postgres"},
        {"kind": "source", "name": "lonely-source", "type": "mysql"},
    ],
    tools=[
        {
            "kind": "tool",
            "name": "get-enrl",
            "type": "oracle-sql",
            "source": "peoplesoft-source",
            "statement": "SELECT * FROM SYSADM.PS_STDNT_ENRL e JOIN ps_stdnt_bio b ON 1=1 WHERE from_date > 1",
        },
        {
            "kind": "tool",
            "name": "search-students",
            "type": "postgres-sql",
            "source": "ontology-cache",
            "statement": "SELECT * FROM students WHERE name ILIKE $1",
        },
        {
            "kind": "tool",
            "name": "broken",
            "type": "x",
            "source": "nope",
            "statement": "",
        },
    ],
    toolsets=[
        {
            "kind": "toolset",
            "name": "enrollment-tools",
            "tools": ["get-enrl", "missing-tool"],
        },
        {"kind": "toolset", "name": "cache-tools", "tools": ["search-students"]},
    ],
)
ROLES = {
    "default": {
        "display_name": "Default",
        "memory_paths": ["/ontology/courses/_index.md"],
        "mcp_toolsets": [],
        "cache_tables": [],
    },
    "Analyst": {
        "display_name": "Analyst",
        "memory_paths": ["/ontology/**"],
        "mcp_toolsets": ["enrollment-tools", "ghost-tools"],
        "cache_tables": ["*"],
    },
    "Exec": {
        "display_name": "Exec",
        "memory_paths": ["/ontology/students/${USER_EMPLID}.md"],
        "mcp_toolsets": ["*"],
        "cache_tables": ["students"],
    },
}
SCHEDULES = [
    {
        "name": "students-full",
        "cron": "0 2 * * *",
        "source": "peoplesoft-oracle",
        "tool": "get-enrl",
        "output": {
            "text_memories": "/ontology/students/",
            "structured_cache": "students",
        },
    },
    {
        "name": "orphan-sched",
        "cron": "0 3 * * *",
        "source": "unknown-svc",
        "tool": "nowhere",
        "output": {},
    },
]
BY_DOMAIN = {
    "_root": {"files": 1},
    "students": {"files": 120},
    "enrollment": {"files": 200},
}


def _graph(**kw):
    return gb.build_graph(
        [_service()],
        reader=READER,
        roles=ROLES,
        schedules=SCHEDULES,
        by_domain=BY_DOMAIN,
        **kw,
    )


def _links(data, kind):
    return {
        (link["source"], link["target"])
        for link in data["links"]
        if link["kind"] == kind
    }


def _node(data, id):
    return next(n for n in data["nodes"] if n["id"] == id)


def test_structure_tables_groups_foreign_keys_and_sql_references():
    data = _graph()
    kinds = Counter(n["kind"] for n in data["nodes"])
    assert kinds["service"] == 1 and kinds["table"] == 3 and kinds["column"] == 0
    assert kinds["entity_group"] == 3 and kinds["memory_domain"] == 2
    assert _links(data, "references") == {
        (
            "table:peoplesoft:SYSADM.PS_STDNT_ENRL",
            "table:peoplesoft:SYSADM.PS_STDNT_BIO",
        )
    }
    assert ("service:peoplesoft", "source:peoplesoft-source") in _links(data, "exposes")
    queries = _links(data, "queries")
    assert ("tool:get-enrl", "table:peoplesoft:SYSADM.PS_STDNT_ENRL") in queries
    assert ("tool:get-enrl", "table:peoplesoft:SYSADM.PS_STDNT_BIO") in queries
    assert ("tool:get-enrl", "table:peoplesoft:SYSADM.PS_FROM_DATE") not in queries
    assert ("tool:search-students", "memory_domain:students") in queries
    assert _node(data, "memory_domain:students")["meta"]["files"] == 120
    assert len(_graph(columns=True)["nodes"]) == len(data["nodes"]) + 4


def test_roles_grants_reads_caches_and_wildcards():
    data = _graph()
    grants = {
        (link["source"], link["target"], link["wildcard"])
        for link in data["links"]
        if link["kind"] == "grants"
    }
    assert ("role:Analyst", "toolset:enrollment-tools", False) in grants
    assert ("role:Analyst", "toolset:ghost-tools", False) in grants
    assert _node(data, "toolset:ghost-tools")["kind"] == "missing"
    assert _node(data, "role:Analyst")["health"] == "dangling"
    assert {t for s, t, w in grants if s == "role:Exec" and w} == {
        "toolset:enrollment-tools",
        "toolset:cache-tools",
    }
    reads = _links(data, "reads")
    assert ("role:Analyst", "memory_domain:students") in reads
    assert ("role:Analyst", "memory_domain:enrollment") in reads
    assert ("role:Exec", "memory_domain:students") in reads
    assert ("role:default", "memory_domain:courses") in reads
    assert _node(data, "memory_domain:courses")["kind"] == "missing"
    caches = _links(data, "caches")
    assert ("role:Analyst", "memory_domain:students") in caches
    assert ("role:Exec", "memory_domain:students") in caches


def test_schedules_health_and_hubs():
    data = _graph()
    assert ("schedule:students-full", "service:peoplesoft") in _links(
        data, "syncs_from"
    )
    assert ("schedule:students-full", "tool:get-enrl") in _links(data, "runs")
    assert ("schedule:students-full", "memory_domain:students") in _links(
        data, "writes"
    )
    assert _node(data, "schedule:orphan-sched")["health"] == "dangling"
    assert _node(data, "service:unknown-svc")["kind"] == "missing"
    assert _node(data, "source:lonely-source")["health"] == "orphan"
    assert data["stats"]["orphans"] == 1
    assert (
        data["stats"]["dangling"] == 5
    )  # Analyst, default, orphan-sched, broken, enrollment-tools
    hubs = data["stats"]["hubs"]
    assert len(hubs) == 5 and hubs[0]["degree"] >= hubs[-1]["degree"]


def test_tool_tables_and_role_domains():
    tables = {"sysadm.ps_x": "t1", "ps_x": "t1", "ps_y": "t2"}
    assert gb.tool_tables(
        "select * from SYSADM.PS_X join PS_Y y update ps_x", tables
    ) == ["t1", "t2"]
    assert gb.tool_tables("select from_date from nowhere", tables) == []
    assert gb.role_domains(
        ["/ontology/**", "/ontology/x/**", "/other/**"], {"a", "b"}
    ) == [
        ("a", True, True),
        ("b", True, True),
        ("x", False, False),
    ]


def test_records_parse_link_and_cap(tmp_path):
    (tmp_path / "students").mkdir()
    (tmp_path / "students" / "S1.md").write_text(
        "---\ntype: student\n---\n# S1\n\n- EMPLID: S1\n"
    )
    (tmp_path / "enrollment").mkdir()
    (tmp_path / "enrollment" / "E1.md").write_text(
        "# E1\n\n- EMPLID: S1\n- CLASS_NBR: 1\n"
    )
    (tmp_path / "enrollment" / "E2.md").write_text("# E2\n\n- EMPLID: S9\n")
    (tmp_path / "enrollment" / "_index.md").write_text("index\n")
    fk_map = gb.record_fk_map([_service()])
    assert fk_map == {"enrollment": [("EMPLID", "students")]}
    out = gb.domain_records(
        "enrollment", files_root=str(tmp_path), fk_map=fk_map, limit=10
    )
    ids = {n["id"] for n in out["nodes"]}
    assert ids == {
        "memory_record:enrollment:E1",
        "memory_record:enrollment:E2",
        "memory_record:students:S1",
    }
    assert out["links"] == [
        {
            "source": "memory_record:enrollment:E1",
            "target": "memory_record:students:S1",
            "kind": "links",
            "wildcard": False,
        }
    ]
    assert out["total"] == 2
    assert _node(out, "memory_record:enrollment:E1")["meta"]["fields"] == {
        "EMPLID": "S1",
        "CLASS_NBR": "1",
    }
    assert gb.parse_record("---\ntype: student\nid: 'S1'\n---\n- name: Ann\n") == {
        "type": "student",
        "id": "S1",
        "name": "Ann",
    }
    capped = gb.domain_records(
        "enrollment", files_root=str(tmp_path), fk_map=fk_map, limit=1
    )
    assert (
        sum(n["group"] == "enrollment" for n in capped["nodes"]) == 1
        and capped["total"] == 2
    )
    assert (
        gb.domain_records("nope", files_root=str(tmp_path), fk_map=fk_map, limit=1)
        is None
    )
