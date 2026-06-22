"""Unit tests for the sync scheduler + runner (no DB / no network)."""

from __future__ import annotations

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
    captured = {}

    class FakeResp:
        def raise_for_status(self):
            pass

        def json(self):
            return [{"EMPLID": "001"}]

    def fake_post(url, json=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        return FakeResp()

    monkeypatch.setattr("iblai_ontology.backend.sync.engine.httpx.post", fake_post)
    runner = SyncRunner(toolbox_url="http://toolbox:5000")
    rows = runner.pull("get-student-enrollment", {"student_id": "001"})
    assert rows == [{"EMPLID": "001"}]
    assert captured["url"] == "http://toolbox:5000/api/tool/get-student-enrollment"
    assert captured["json"] == {"student_id": "001"}


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
