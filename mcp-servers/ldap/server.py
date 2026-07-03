# mcp-servers/ldap/server.py
#
# LDAP / Active Directory custom MCP server (HR / org chart). Read-only.
# Credential isolation: this process only ever sees LDAP bind credentials.

import json
import os

from ldap3 import ALL, SUBTREE, Connection
from ldap3 import Server as LdapServer
from mcp.server.fastmcp import FastMCP
from mcp.types import TextContent

LDAP_URI = os.environ["LDAP_URI"]
LDAP_BIND_DN = os.environ["LDAP_BIND_DN"]
LDAP_BIND_PASSWORD = os.environ["LDAP_BIND_PASSWORD"]
LDAP_BASE_DN = os.environ["LDAP_BASE_DN"]

server = FastMCP("ldap-mcp")


def _connect() -> Connection:
    ldap_server = LdapServer(LDAP_URI, get_info=ALL)
    return Connection(
        ldap_server,
        user=LDAP_BIND_DN,
        password=LDAP_BIND_PASSWORD,
        auto_bind=True,
    )


@server.tool()
async def get_employee(email: str) -> list[TextContent]:
    """Look up an employee directory record by email address."""
    conn = _connect()
    conn.search(
        LDAP_BASE_DN,
        f"(mail={email})",
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
        LDAP_BASE_DN,
        f"(department={department})",
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
