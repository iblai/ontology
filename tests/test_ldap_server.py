"""LDAP MCP server filter-building tests (no LDAP connection, no env needed).

The server lives under ``mcp-servers/ldap`` (a hyphenated dir that is not an
importable package), so it is loaded by file path. Module import must stay
side-effect free — env vars are only read inside ``_connect``.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

ldap3 = pytest.importorskip("ldap3")


def _load_ldap_server():
    path = Path(__file__).resolve().parents[1] / "mcp-servers" / "ldap" / "server.py"
    spec = importlib.util.spec_from_file_location("ldap_mcp_server_undertest", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ldap_server = _load_ldap_server()


def test_employee_filter_escapes_wildcard_injection():
    # The classic `*)(objectClass=*` payload must not create a wildcard filter.
    payload = "*)(objectClass=*"
    built = ldap_server._employee_filter(payload)
    assert "*" not in built.replace("\\2a", "")  # only escaped forms remain
    assert "(objectClass=" not in built
    assert built == "(mail=\\2a\\29\\28objectClass=\\2a)"


def test_org_structure_filter_escapes_injection():
    built = ldap_server._org_structure_filter("Sales)(uid=*")
    assert "(uid=" not in built
    assert built == "(department=Sales\\29\\28uid=\\2a)"


def test_filters_pass_through_plain_values():
    assert ldap_server._employee_filter("jdoe@x.edu") == "(mail=jdoe@x.edu)"
    assert ldap_server._org_structure_filter("Physics") == "(department=Physics)"
