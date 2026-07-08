# mcp-servers/ldap/server.py
#
# LDAP / Active Directory custom MCP server (HR / org chart). Read-only.
# Credential isolation: this process only ever sees LDAP bind credentials.

import json
import os

from ldap3 import ALL, SUBTREE, Connection
from ldap3 import Server as LdapServer
from ldap3.utils.conv import escape_filter_chars
from mcp.server.fastmcp import FastMCP
from mcp.types import TextContent

server = FastMCP("ldap-mcp")


def _connect() -> Connection:
    ldap_server = LdapServer(os.environ["LDAP_URI"], get_info=ALL)
    return Connection(
        ldap_server,
        user=os.environ["LDAP_BIND_DN"],
        password=os.environ["LDAP_BIND_PASSWORD"],
        auto_bind=True,
    )


def _employee_filter(email: str) -> str:
    """LDAP filter to look up an employee by email, with the value escaped.

    ``email`` is escaped per RFC 4515 so filter metacharacters (``*()\\``) are
    treated as literals and cannot alter the filter's logic.
    """
    return f"(mail={escape_filter_chars(email)})"


def _org_structure_filter(department: str) -> str:
    """LDAP filter for a department's members, with the value escaped (RFC 4515)."""
    return f"(department={escape_filter_chars(department)})"


@server.tool()
async def get_employee(email: str) -> list[TextContent]:
    """Look up an employee directory record by email address."""
    conn = _connect()
    conn.search(
        os.environ["LDAP_BASE_DN"],
        _employee_filter(email),
        search_scope=SUBTREE,
        attributes=["displayName", "title", "department", "manager", "mail"],
    )
    entries = [
        {
            "name": str(e.displayName),
            "title": str(e.title),
            "department": str(e.department),
            "manager": str(e.manager),
            "email": str(e.mail),
        }
        for e in conn.entries
    ]
    conn.unbind()
    return [TextContent(type="text", text=json.dumps(entries, indent=2))]


@server.tool()
async def get_org_structure(department: str) -> list[TextContent]:
    """List the members of a department for org-chart construction."""
    conn = _connect()
    conn.search(
        os.environ["LDAP_BASE_DN"],
        _org_structure_filter(department),
        search_scope=SUBTREE,
        attributes=["displayName", "title", "manager", "mail"],
    )
    members = [
        {
            "name": str(e.displayName),
            "title": str(e.title),
            "manager": str(e.manager),
            "email": str(e.mail),
        }
        for e in conn.entries
    ]
    conn.unbind()
    return [TextContent(type="text", text=json.dumps(members, indent=2))]


if __name__ == "__main__":
    server.run()
