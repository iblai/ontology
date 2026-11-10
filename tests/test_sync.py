"""Unit tests for the sync scheduler + runner (no DB / no network)."""

from __future__ import annotations

import json

import pytest

from iblai_ontology.backend.sync import scheduler
from iblai_ontology.backend.sync.engine import SyncRunner


def test_parse_cron_fields():
    assert scheduler._parse_cron("*/5 * * * *") == {
        "minute": "*/5",
        "hour": "*",
        "day_of_month": "*",
        "month_of_year": "*",
        "day_of_week": "*",
    }
    # short expressions pad with '*'
    assert scheduler._parse_cron("0 2")["hour"] == "2"


def test_infer_mode():
    assert scheduler.infer_mode("*/5 * * * *") == "delta"
    assert scheduler.infer_mode("0 2 * * *") == "full"


def test_build_beat_schedule(tmp_path, monkeypatch):
    cfg = tmp_path / "config"
    cfg.mkdir()
    (cfg / "sync-schedules.yaml").write_text(
        "schedules:\n"
        "  - name: students-full\n"
        "    cron: '0 2 * * *'\n"
        "    source: peoplesoft\n"
        "    tool: get-all-students\n"
        "  - name: event-only\n"
        "    source: canvas\n"
        "    tool: webhook\n"  # no cron -> skipped
    )
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(cfg))
    beat = scheduler.build_beat_schedule()
    assert "sync-students-full" in beat
    assert "sync-event-only" not in beat  # no cron
    assert beat["sync-students-full"]["args"] == ("students-full",)


def test_runner_pull_invokes_toolbox(monkeypatch):
    """pull() calls the Toolbox /mcp JSON-RPC endpoint and unwraps row content."""
    captured = {}

    class FakeResp:
        status_code = 200
        headers = {"content-type": "application/json"}
        text = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "content": [{"type": "text", "text": json.dumps({"EMPLID": "001"})}]
                },
            }
        )

        def raise_for_status(self):
            pass

    def fake_post(url, json=None, headers=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        return FakeResp()

    monkeypatch.setattr(
        "iblai_ontology.backend.mcp_server.toolbox_client.httpx.post", fake_post
    )
    runner = SyncRunner(toolbox_url="http://toolbox:5000")
    rows = runner.pull("get-student-enrollment", {"student_id": "001"})
    assert rows == [{"EMPLID": "001"}]
    assert captured["url"] == "http://toolbox:5000/mcp"
    assert captured["json"]["method"] == "tools/call"
    assert captured["json"]["params"] == {
        "name": "get-student-enrollment",
        "arguments": {"student_id": "001"},
    }


def test_pull_raises_when_the_tool_reports_an_error(monkeypatch):
    """FastMCP and the Toolbox send a failing tool's message as isError content."""
    from iblai_ontology.backend.mcp_server.toolbox_client import ToolboxError

    class FakeResp:
        status_code = 200
        headers = {"content-type": "application/json"}
        text = json.dumps(
            {
                "jsonrpc": "2.0",
                "id": 1,
                "result": {
                    "content": [{"type": "text", "text": "Error executing tool: boom"}],
                    "isError": True,
                },
            }
        )

        def raise_for_status(self):
            pass

    monkeypatch.setattr(
        "iblai_ontology.backend.mcp_server.toolbox_client.httpx.post",
        lambda *a, **k: FakeResp(),
    )
    with pytest.raises(ToolboxError, match="Error executing tool: boom"):
        SyncRunner(toolbox_url="http://toolbox:5000").pull("get-x")


def test_detect_primary_key():
    from iblai_ontology.backend.sync.writer import detect_primary_key

    assert detect_primary_key({"EMPLID": "1", "name": "x"}) == "emplid"
    assert detect_primary_key({"id": 1}) == "id"
    assert detect_primary_key({"course_id": 1, "title": "x"}) == "course_id"
    assert detect_primary_key({"foo": 1}) == "foo"


def test_write_memories_no_db(tmp_path):
    from iblai_ontology.backend.sync.writer import write_memories

    class FakeIndexer:
        def __init__(self):
            self.indexed = []

        def index_file(self, path, text):
            self.indexed.append(path)

    idx = FakeIndexer()
    files = write_memories(
        [{"id": "001", "full_name": "Jane", "fields": {}}],
        entity_group="students",
        primary_key="id",
        files_root=str(tmp_path),
        indexer=idx,
    )
    assert len(files) == 1
    assert (tmp_path / "students" / "001.md").exists()
    assert idx.indexed == ["/ontology/students/001.md"]


def test_write_memories_stops_indexing_after_the_first_failure(tmp_path, caplog):
    from iblai_ontology.backend.sync.writer import write_memories

    class DownIndexer:
        calls = 0

        def index_file(self, path, text):
            self.calls += 1
            raise ConnectionError("vector-store: name or service not known")

    idx = DownIndexer()
    with caplog.at_level("WARNING", logger="iblai_ontology.sync"):
        files = write_memories(
            [{"id": "1"}, {"id": "2"}, {"id": "3"}],
            entity_group="courses",
            primary_key="id",
            files_root=str(tmp_path),
            indexer=idx,
        )
    assert len(files) == 3  # every memory still written
    assert idx.calls == 1  # one timeout, not one per row
    assert "vector index unavailable" in caplog.text


def test_disabled_schedule_skipped_by_beat_and_run_all_due(tmp_path, monkeypatch):
    cfg = tmp_path / "config"
    cfg.mkdir()
    (cfg / "sync-schedules.yaml").write_text(
        "schedules:\n"
        "  - name: alpha\n"
        "    cron: '0 2 * * *'\n"
        "    source: peoplesoft\n"
        "    tool: get-a\n"
        "  - name: beta\n"
        "    cron: '0 3 * * *'\n"
        "    source: peoplesoft\n"
        "    tool: get-b\n"
        "    enabled: false\n"
    )
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(cfg))
    beat = scheduler.build_beat_schedule()
    assert "sync-alpha" in beat and "sync-beta" not in beat

    ran: list[str] = []
    runner = SyncRunner()
    monkeypatch.setattr(
        runner, "_run_schedule", lambda sched, force_full: ran.append(sched["name"])
    )
    runner.run_all_due()
    runner.run_service("peoplesoft")
    assert ran == ["alpha", "alpha"]


def test_run_service_matches_ownership_not_prefix(tmp_path, monkeypatch):
    # `twenty` is a prefix of `twenty-cloud`: a sync of one must not run the other's schedules.
    cfg = tmp_path / "config"
    cfg.mkdir()
    (cfg / "sync-schedules.yaml").write_text(
        "schedules:\n"
        "  - name: twenty-person\n"
        "    cron: '0 * * * *'\n"
        "    source: twenty-source\n"
        "    service: twenty\n"
        "    table: w.person\n"
        "  - name: twenty-cloud-people\n"
        "    cron: '0 * * * *'\n"
        "    source: twenty-cloud-mcp\n"
        "    tool: list-people\n"
    )
    monkeypatch.setenv("ONTOLOGY_CONFIG_DIR", str(cfg))
    ran: list[str] = []
    runner = SyncRunner()
    monkeypatch.setattr(
        runner, "_run_schedule", lambda sched, force_full: ran.append(sched["name"])
    )
    runner.run_service("twenty")
    assert ran == ["twenty-person"]
    runner.run_service("twenty-cloud")
    assert ran == ["twenty-person", "twenty-cloud-people"]
