"""Guard: print_db_url must never leak the DB password."""

import pytest

pytest.importorskip("django")

from iblai_ontology.backend.api.management.commands.print_db_url import _masked_url


def test_masked_url_hides_password():
    db = {
        "ENGINE": "django.db.backends.postgresql",
        "USER": "ibl",
        "PASSWORD": "s3cr3t-value",
        "HOST": "db.internal",
        "PORT": 5432,
        "NAME": "ontology",
    }
    url = _masked_url(db)
    assert "s3cr3t-value" not in url
    assert url == "postgresql://ibl:*@db.internal:5432/ontology"


def test_masked_url_no_user_no_leak():
    url = _masked_url(
        {"ENGINE": "postgresql", "PASSWORD": "hunter2", "HOST": "h", "NAME": "d"}
    )
    assert "hunter2" not in url
