"""Build the relationship graph: services, tables, their terms, MCP config, roles, schedules, memories.

Nodes are ``{id, kind, label, group, meta, health}``; links are typed ``{source, target,
kind}`` (the inverse is implied by direction). A reference to something that does not
exist becomes a ``missing`` stub node and marks the referrer ``dangling``; a node with no
links is an ``orphan`` (the second-brain lint rules).
"""

from __future__ import annotations

import re
from collections import Counter
from pathlib import Path

from iblai_ontology.backend.discovery.config_generator import _bare
from iblai_ontology.backend.discovery.config_generator import (
    table_descriptions as _descriptions,
)
from iblai_ontology.backend.mcp_server.toolbox_compat import writing_tools
from iblai_ontology.backend.mcp_server.toolbox_config import GATEWAY_TYPES

# The HTTP method a tool the gateway runs itself sends, per operation.
_GATEWAY_METHOD = {"create": "POST", "update": "PATCH"}

# ponytail: table names after FROM/JOIN/INTO/UPDATE; a real SQL parser if statements get exotic.
_SQL_TABLE_RE = re.compile(r"\b(?:from|join|into|update)\s+([A-Za-z_][\w$.]*)", re.I)
_FRONT_RE = re.compile(r"\A---\n(.*?)\n---\n", re.S)
_FIELD_RE = re.compile(r"^(?:- |)\**([A-Za-z_][\w .-]*?)\**:\s+(.+?)\s*$", re.M)
RECORD_CAP = 2000


def nid(kind: str, *parts: str) -> str:
    return f"{kind}:" + ":".join(parts)


def _domain_of(path: str) -> str:
    """``/ontology/students/`` -> ``students``; the folder is the entity group."""
    parts = [p for p in str(path or "").split("/") if p]
    return (
        parts[1]
        if len(parts) >= 2 and parts[0] == "ontology"
        else (parts[0] if parts else "")
    )


class _Graph:
    def __init__(self) -> None:
        self.nodes: dict[str, dict] = {}
        self.links: list[dict] = []

    def node(
        self, kind: str, name: str, *, label: str | None = None, group: str = "", **meta
    ) -> str:
        id = nid(kind, name)
        existing = self.nodes.get(id)
        if existing is None:
            self.nodes[id] = {
                "id": id,
                "kind": kind,
                "label": label or name.rsplit(":", 1)[-1],
                "group": group,
                "meta": meta,
                "health": None,
            }
        elif meta:
            existing["meta"].update(meta)
        return id

    def link(
        self, source: str, target: str, kind: str, *, wildcard: bool = False
    ) -> None:
        self.links.append(
            {"source": source, "target": target, "kind": kind, "wildcard": wildcard}
        )

    def ref(
        self,
        source: str,
        kind: str,
        target_kind: str,
        name: str,
        *,
        wildcard: bool = False,
    ) -> None:
        """Link to an existing node, or to a ``missing`` stub that marks the referrer dangling."""
        target = nid(target_kind, name)
        if target not in self.nodes:
            self.nodes[target] = {
                "id": target,
                "kind": "missing",
                "label": name,
                "group": target_kind,
                "meta": {"expected": target_kind},
                "health": "missing",
            }
            self.nodes[source]["health"] = "dangling"
        self.link(source, target, kind, wildcard=wildcard)


def tool_tables(statement: str, tables: dict[str, str]) -> list[str]:
    """Table ids a SQL statement reads, matched by bare or qualified name (lower-cased)."""
    out: list[str] = []
    for raw in _SQL_TABLE_RE.findall(statement or ""):
        name = raw.lower().strip(".")
        hit = tables.get(name) or tables.get(name.rsplit(".", 1)[-1])
        if hit and hit not in out:
            out.append(hit)
    return out


def role_domains(
    memory_paths: list[str], domains: set[str]
) -> list[tuple[str, bool, bool]]:
    """``(domain, wildcard, exists)`` per pattern; ``/ontology/**`` reaches every domain."""
    out: list[tuple[str, bool, bool]] = []
    for pattern in memory_paths or []:
        parts = [p for p in str(pattern).split("/") if p]
        if len(parts) < 2 or parts[0] != "ontology":
            continue
        if parts[1] in ("*", "**"):
            out += [(d, True, True) for d in sorted(domains)]
        else:
            out.append((parts[1], False, parts[1] in domains))
    return out


def build_graph(
    services,
    *,
    reader,
    roles: dict[str, dict],
    schedules: list[dict],
    by_domain: dict[str, dict],
    columns: bool = False,
    terms: dict[str, list[dict]] | None = None,
) -> dict:
    """``terms``: per Auto Ontology system, the terms it was read for (services/auto_ontology.py)."""
    g = _Graph()
    tables_by_service: dict[str, dict[str, str]] = {}
    group_of_table: dict[str, str] = {}
    holders: dict[str, list[str]] = {}  # a database's name -> the systems that hold it

    # Services, tables, columns, entity groups, foreign keys.
    for s in services:
        sid = g.node(
            "service",
            s.name,
            label=s.display_name or s.name,
            group=s.name,
            adapter=s.adapter,
            status=s.status,
        )
        descs = _descriptions(s.llm_analysis or {})
        lookup: dict[str, str] = {}
        tables = (s.schema_manifest or {}).get("tables") or []
        for t in tables:
            schema = str(t.get("schema_name") or "")
            name = str(t.get("table_name") or "")
            qualified = f"{schema}.{name}" if schema else name
            td = descs.get(qualified) or descs.get(name) or {}
            group = str(td.get("entity_group") or "other")
            tid = g.node(
                "table",
                f"{s.name}:{qualified}",
                label=name,
                group=group,
                service=s.name,
                schema=schema,
                row_count=int(t.get("row_count") or 0),
                column_count=int(t.get("column_count") or len(t.get("columns") or [])),
                entity=str(td.get("entity") or ""),
            )
            lookup[qualified.lower()] = tid
            lookup[name.lower()] = tid
            group_of_table[tid] = group
            g.link(sid, tid, "has_table")
            # The term a model wrote for it here (discovery/terms.py): no one has certified it.
            own = t.get("term") or {}
            if own.get("id"):
                term_id = g.node(
                    "term",
                    f"{s.name}:{own['id']}",
                    label=str(own.get("name") or own["id"]),
                    service=s.name,
                    description=str(own.get("description") or ""),
                    synonyms=list(own.get("synonyms") or []),
                    certification="pending",
                    generated=True,
                )
                g.link(tid, term_id, "represents")
            g.link(
                tid, g.node("entity_group", group, label=group, group=group), "in_group"
            )
            if columns:
                for c in t.get("columns") or []:
                    cname = str(c.get("name") or "")
                    cid = g.node(
                        "column",
                        f"{s.name}:{qualified}.{cname}",
                        label=cname,
                        group=group,
                        data_type=str(c.get("data_type") or ""),
                        table=tid,
                        fk=f"{c.get('foreign_key_table')}.{c.get('foreign_key_column')}"
                        if c.get("foreign_key_table")
                        else "",
                    )
                    g.link(tid, cid, "has_column")
        tables_by_service[s.name] = lookup
        database = str((s.schema_manifest or {}).get("database") or "").lower()
        if database:
            holders.setdefault(database, []).append(s.name)
        for t in tables:
            schema = str(t.get("schema_name") or "")
            name = str(t.get("table_name") or "")
            tid = lookup[(f"{schema}.{name}" if schema else name).lower()]
            fks = list(t.get("foreign_keys") or [])
            for c in t.get("columns") or []:
                if c.get("foreign_key_table"):
                    fks.append(
                        {
                            "column": c.get("name"),
                            "references_table": c["foreign_key_table"],
                        }
                    )
            for fk in fks:
                ref = lookup.get(str(fk.get("references_table") or "").lower())
                if ref and ref != tid:
                    g.link(tid, ref, "references")

    # Terms: what an Auto Ontology server says a table means, and the joins it inferred.
    joined = {
        frozenset((link["source"], link["target"]))
        for link in g.links
        if link["kind"] == "references"
    }

    def ours(place) -> str | None:
        """Our table for NVIDIA's (database, schema, table): only when one system here holds that database."""
        database, schema, table = (str(part or "").lower() for part in place)
        held = holders.get(database) or []
        if len(held) != 1:
            return None  # none holds it, or two do and nothing says which one is meant
        return tables_by_service[held[0]].get(f"{schema}.{table}" if schema else table)

    for layer, rows in (terms or {}).items():
        for term in rows:
            matched = [
                ours((t.get("database"), t.get("schema"), t.get("table")))
                for t in term.get("tables") or []
                if t.get("holds")
            ]
            held = list(dict.fromkeys(tid for tid in matched if tid))
            if not held:
                continue  # all of its tables are elsewhere
            term_id = g.node(
                "term",
                f"{layer}:{term.get('id')}",
                label=str(term.get("name") or term.get("id")),
                service=layer,
                description=str(term.get("description") or ""),
                synonyms=list(term.get("synonyms") or []),
                certification=str(term.get("certification") or ""),
                # Its tables that are not on this map: in a system not connected here, or a view.
                elsewhere=matched.count(None),
            )
            for tid in held:
                g.link(tid, term_id, "represents")
            for source, target in term.get("joins") or []:
                a, b = ours(source), ours(target)
                # A declared foreign key is drawn as `references` already.
                if a and b and a != b and frozenset((a, b)) not in joined:
                    joined.add(frozenset((a, b)))
                    g.link(a, b, "joins")

    # Memory domains: synced folders and the ones schedules write.
    domains: set[str] = {d for d in by_domain if d != "_root"}
    cache_domain: dict[str, str] = {}
    for sched in schedules:
        out = sched.get("output") or {}
        d = _domain_of(out.get("text_memories") or "")
        if d:
            domains.add(d)
            if out.get("structured_cache"):
                cache_domain[str(out["structured_cache"])] = d
    for d in sorted(domains):
        g.node(
            "memory_domain",
            d,
            label=d,
            group=d,
            files=int((by_domain.get(d) or {}).get("files", 0)),
            # The tables it is cached in: what a role's cache grant has to name.
            cache_tables=sorted(t for t, of in cache_domain.items() if of == d),
        )

    # MCP sources, tools, toolsets.
    service_of_source: dict[str, str] = {}
    for src in reader.get_sources():
        name = str(src.get("name") or "")
        g.node(
            "source",
            name,
            label=name,
            group="mcp",
            type=str(src.get("type") or ""),
            host=str(src.get("host") or ""),
        )
        for s in services:
            # A custom API has two: one its tools read through, one they change data through.
            own = (f"{s.name}-source", s.name, f"{s.name}-reads", f"{s.name}-writes")
            if name in own:
                g.link(nid("service", s.name), nid("source", name), "exposes")
                service_of_source[name] = s.name
    tools = reader.get_tools()
    writing = writing_tools(tools)
    for tool in tools:
        name = str(tool.get("name") or "")
        kind = str(tool.get("type") or "")
        source = str(tool.get("source") or "")
        svc = service_of_source.get(source)
        if kind == "http":
            method = str(tool.get("method") or "").upper()
        else:
            gateway = kind in GATEWAY_TYPES
            method = (
                _GATEWAY_METHOD.get(str(tool.get("operation")), "") if gateway else ""
            )
        tid = g.node(
            "tool",
            name,
            label=name,
            group="mcp",
            type=kind,
            source=source,
            description=str(tool.get("description") or ""),
            statement=str(tool.get("statement") or ""),
            # What Access switches on: whether it can change data, how, and whose it is.
            write=name in writing,
            method=method,
            service=str(tool.get("service") or svc or ""),
        )
        if source:
            g.ref(tid, "uses_source", "source", source)
        elif nid("service", str(tool.get("service") or "")) in g.nodes:
            # A tool the gateway runs on the system itself has no source between them.
            g.link(nid("service", str(tool["service"])), tid, "exposes")
        lookup = (
            tables_by_service.get(svc, {})
            if svc
            else {
                nid("memory_domain", d).rsplit(":", 1)[-1].lower(): nid(
                    "memory_domain", d
                )
                for d in domains
            }
        )
        for target in tool_tables(str(tool.get("statement") or ""), lookup):
            g.link(tid, target, "queries")
    for name, ts in reader.get_toolsets().items():
        # write: its tools can change data, so a role holds it by name, never through `*`.
        sid = g.node(
            "toolset", name, label=name, group="mcp", write=bool(ts.get("write"))
        )
        for t in ts.get("tools") or []:
            g.ref(sid, "contains", "tool", str(t))

    # Schedules: what they pull from, run and write.
    for sched in schedules:
        name = str(sched.get("name") or "")
        sid = g.node(
            "schedule",
            name,
            label=name,
            group="sync",
            cron=str(sched.get("cron") or ""),
            mode=str(sched.get("mode") or "cron"),
            enabled=sched.get("enabled", True) is not False,
            description=str(sched.get("description") or ""),
        )
        source = str(sched.get("source") or "")
        # The sync engine matches a schedule's source by service-name prefix.
        svc_match = next(
            (
                s.name
                for s in services
                if source == s.name or source.startswith(f"{s.name}-")
            ),
            None,
        )
        if svc_match:
            g.link(sid, nid("service", svc_match), "syncs_from")
        elif nid("source", source) in g.nodes:
            g.link(sid, nid("source", source), "syncs_from")
        else:
            g.ref(sid, "syncs_from", "service", source)
        if sched.get("tool"):
            g.ref(sid, "runs", "tool", str(sched["tool"]))
        # A database schedule reads one table of its service straight through the connection.
        table_id = tables_by_service.get(svc_match or "", {}).get(
            str(sched.get("table") or "").lower()
        )
        if table_id:
            g.link(sid, table_id, "queries")
        d = _domain_of((sched.get("output") or {}).get("text_memories") or "")
        if d:
            g.link(sid, nid("memory_domain", d), "writes")

    # Roles: what each one may reach. `*` is every toolset that only reads.
    toolset_ids = [
        id
        for id, node in g.nodes.items()
        if node["kind"] == "toolset" and not node["meta"].get("write")
    ]
    for name, spec in roles.items():
        rid = g.node(
            "role",
            name,
            label=str(spec.get("display_name") or name),
            group="roles",
            admin_dashboard=bool(spec.get("admin_dashboard")),
            agents=list(spec.get("agents") or []),
            memory_paths=list(spec.get("memory_paths") or []),
            cache_tables=list(spec.get("cache_tables") or []),
            mcp_toolsets=list(spec.get("mcp_toolsets") or []),
            mcp_tools=list(spec.get("mcp_tools") or []),
        )
        # A tool held by its own name, beside what the toolsets lend.
        for tool in spec.get("mcp_tools") or []:
            g.ref(rid, "grants", "tool", str(tool))
        granted = spec.get("mcp_toolsets") or []
        through_all = toolset_ids if "*" in granted else []
        for tsid in through_all:
            g.link(rid, tsid, "grants", wildcard=True)
        for ts in granted:
            # A name beside `*` is drawn too, unless `*` already reaches it.
            if ts != "*" and nid("toolset", str(ts)) not in through_all:
                g.ref(rid, "grants", "toolset", str(ts))
        for d, wildcard, exists in role_domains(
            spec.get("memory_paths") or [], domains
        ):
            if exists:
                g.link(rid, nid("memory_domain", d), "reads", wildcard=wildcard)
            else:
                g.ref(rid, "reads", "memory_domain", d)
        caches = spec.get("cache_tables") or []
        if "*" in caches:
            for d in sorted(set(cache_domain.values())):
                g.link(rid, nid("memory_domain", d), "caches", wildcard=True)
        else:
            for c in caches:
                d = cache_domain.get(str(c)) or (str(c) if str(c) in domains else "")
                if d:
                    g.link(rid, nid("memory_domain", d), "caches")
                else:
                    g.ref(rid, "caches", "memory_domain", str(c))

    # Health and hubs.
    degree: Counter = Counter()
    for link in g.links:
        degree[link["source"]] += 1
        degree[link["target"]] += 1
    for id, n in g.nodes.items():
        if degree[id] == 0 and n["health"] is None:
            n["health"] = "orphan"
    hubs = [
        {
            "id": id,
            "label": g.nodes[id]["label"],
            "kind": g.nodes[id]["kind"],
            "degree": d,
        }
        for id, d in degree.most_common(5)
    ]
    return {
        "nodes": list(g.nodes.values()),
        "links": g.links,
        "stats": {
            "hubs": hubs,
            "orphans": sum(n["health"] == "orphan" for n in g.nodes.values()),
            "dangling": sum(n["health"] == "dangling" for n in g.nodes.values()),
        },
    }


# -- memory records ------------------------------------------------------------


def record_fk_map(services) -> dict[str, list[tuple[str, str]]]:
    """``{domain: [(column, referenced domain)]}`` from the manifests; domains are entity groups."""
    out: dict[str, list[tuple[str, str]]] = {}
    for s in services:
        descs = _descriptions(s.llm_analysis or {})
        tables = (s.schema_manifest or {}).get("tables") or []
        group_by_bare = {}
        for t in tables:
            name = str(t.get("table_name") or "")
            schema = str(t.get("schema_name") or "")
            td = (
                descs.get(f"{schema}.{name}" if schema else name)
                or descs.get(name)
                or {}
            )
            group_by_bare[name.lower()] = str(td.get("entity_group") or "other")
        for t in tables:
            name = str(t.get("table_name") or "")
            group = group_by_bare[name.lower()]
            fks = list(t.get("foreign_keys") or [])
            for c in t.get("columns") or []:
                if c.get("foreign_key_table"):
                    fks.append(
                        {
                            "column": c.get("name"),
                            "references_table": c["foreign_key_table"],
                        }
                    )
            for fk in fks:
                ref_group = group_by_bare.get(
                    _bare(str(fk.get("references_table") or "")).lower()
                )
                if ref_group and fk.get("column"):
                    pair = (str(fk["column"]), ref_group)
                    if pair not in out.setdefault(group, []):
                        out[group].append(pair)
    return out


def parse_record(text: str) -> dict[str, str]:
    """Frontmatter keys and ``- key: value`` lines of a memory file."""
    fields: dict[str, str] = {}
    m = _FRONT_RE.match(text)
    body = text
    if m:
        for line in m.group(1).splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                fields[k.strip()] = v.strip().strip("\"'")
        body = text[m.end() :]
    for k, v in _FIELD_RE.findall(body):
        fields.setdefault(k.strip(), v.strip())
    return fields


def domain_records(
    domain: str,
    *,
    files_root: str,
    fk_map: dict[str, list[tuple[str, str]]],
    limit: int,
) -> dict | None:
    """Up to ``limit`` records of a memory domain with their foreign-key links, or None if absent."""
    root = Path(files_root)
    folder = root / domain
    if not folder.is_dir():
        return None
    files = sorted(p for p in folder.glob("*.md") if not p.name.startswith("_"))
    nodes: dict[str, dict] = {}
    links: list[dict] = []
    for path in files[: min(limit, RECORD_CAP)]:
        fields = parse_record(path.read_text(errors="replace"))
        rid = nid("memory_record", domain, path.stem)
        nodes[rid] = {
            "id": rid,
            "kind": "memory_record",
            "label": path.stem,
            "group": domain,
            "meta": {"domain": domain, "fields": dict(list(fields.items())[:12])},
            "health": None,
        }
        for column, ref_domain in fk_map.get(domain, []):
            value = fields.get(column)
            if value and (root / ref_domain / f"{value}.md").is_file():
                target = nid("memory_record", ref_domain, value)
                nodes.setdefault(
                    target,
                    {
                        "id": target,
                        "kind": "memory_record",
                        "label": value,
                        "group": ref_domain,
                        "meta": {"domain": ref_domain, "fields": {}},
                        "health": None,
                    },
                )
                links.append(
                    {
                        "source": rid,
                        "target": target,
                        "kind": "links",
                        "wildcard": False,
                    }
                )
    return {"nodes": list(nodes.values()), "links": links, "total": len(files)}
