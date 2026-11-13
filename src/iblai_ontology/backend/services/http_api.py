"""A custom API: any HTTP API an administrator connects, called by the MCP Toolbox.

The address, the name of one secret header and its value are the system's registry entry,
encrypted as a database's login is. Each endpoint the administrator names is one ``http``
tool of tools.yaml on the system's own two sources: one for the tools that read, one for
those that change data. The Toolbox makes the call; the gateway adds the key to it
(``signed``), so the key is in no file.
"""

from __future__ import annotations

import ipaddress
import json
import re
import socket
from urllib.parse import urlsplit

import yaml

ADAPTER = "http_api"
METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE")
BODIES = ("POST", "PUT", "PATCH")  # the methods a JSON body goes with
TIMEOUT = "20s"  # the Toolbox's, under the gateway's own 30 s for a Toolbox call
TOOL_NAME_MAX = 64  # what an agent's model takes for a tool's name
MASK = "********"
# The private networks a system inside one may reach; loopback and link-local are in none.
PRIVATE = ("10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7")
_PRIVATE = [ipaddress.ip_network(net) for net in PRIVATE]
# A host and a path: nothing the Toolbox's file would read as its own (`$`, braces), no sign-in.
_ADDRESS = re.compile(r"^[A-Za-z0-9._~:/\[\]-]+$")
_SLUG = re.compile(r"^[a-z0-9][a-z0-9-]*$")
_HEADER = re.compile(r"^[A-Za-z0-9-]{1,64}$")
# The request's own headers, never a key's.
_OWN_HEADERS = {
    "host",
    "content-type",
    "content-length",
    "connection",
    "transfer-encoding",
    "user-agent",
}
# A value in a path as it is entered, `{id}`, and as the Toolbox takes it.
_PLACE = re.compile(r"\{([A-Za-z][A-Za-z0-9_]*)\}")
_ESCAPED = re.compile(r"\{\{pathEscape \.([A-Za-z][A-Za-z0-9_]*)\}\}")
_SEGMENT = re.compile(r"^(?:[A-Za-z0-9._~-]|\{[A-Za-z][A-Za-z0-9_]*\})+$")
_QUERY = re.compile(r"^[A-Za-z][A-Za-z0-9_.-]{0,63}$")


class ApiError(RuntimeError):
    """What a custom API's set-up or call refuses: said in words an admin or an agent can act on."""


def address(base: str) -> tuple[str, bool]:
    """An API's address as it is kept (ending in ``/``), and whether it is inside a private network.

    https, or http inside a private network only: the key rides on every call. What the
    host resolves to now decides, as the Toolbox's own guard will: this machine and
    link-local addresses (a cloud's metadata) are refused here, since every call would be.
    """
    kept = base.strip().rstrip("/") + "/"
    url = urlsplit(kept)
    if url.scheme not in ("http", "https") or not url.hostname:
        raise ApiError(f"{base!r} is not an address: one starts with https://")
    if not _ADDRESS.match(kept) or len(kept) > 255:
        raise ApiError(
            "An address is a host and a path, nothing else: its key goes in its own field."
        )
    try:
        found = socket.getaddrinfo(url.hostname, None)
    except OSError as exc:
        raise ApiError(
            f"{url.hostname} does not resolve from this server ({exc})."
        ) from exc
    ips = {ipaddress.ip_address(info[4][0].split("%")[0]) for info in found}
    own = sorted(
        str(ip)
        for ip in ips
        if ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_unspecified
    )
    if own:
        raise ApiError(
            f"{url.hostname} is this machine or a link-local address ({own[0]}): "
            "neither is called from here."
        )
    inside = any(ip in net for ip in ips for net in _PRIVATE)
    if url.scheme == "http" and not inside:
        raise ApiError(
            "An address outside a private network starts with https://: "
            "a key would cross the internet in clear."
        )
    return kept, inside


def _header(name: str, key: str) -> tuple[str, str]:
    """The secret header as it is kept; both empty for an API that asks for no key."""
    name, key = name.strip(), key.strip()
    if not key:
        return "", ""
    name = name or "Authorization"
    if not _HEADER.match(name) or name.lower() in _OWN_HEADERS:
        raise ApiError(f"{name!r} is not a header a key goes in.")
    if not key.isprintable():
        raise ApiError("The key holds a character no header carries.")
    return name, key


def _names(name: str) -> tuple[str, str]:
    """A system's two sources, and its two toolsets of the same names: reads, then changes."""
    return f"{name}-reads", f"{name}-writes"


def _generator():
    from iblai_ontology.backend.provisioning.tools_generator import ToolsGenerator

    return ToolsGenerator()


def _dump(docs: list[dict]) -> str:
    return yaml.dump_all(docs, default_flow_style=False, sort_keys=False)


def _errors(report) -> str:
    return "; ".join(i.message for i in report.issues if i.severity == "error")[:500]


def _owns(name: str, doc: dict) -> bool:
    """Whether a tools.yaml document is one of the system's endpoints."""
    return (
        doc.get("kind") == "tool"
        and doc.get("type") == "http"
        and doc.get("service") == name
    )


def _config(service) -> dict:
    from iblai_ontology.backend.services.encryption import decrypt_connection_config

    return decrypt_connection_config(service.connection_config_encrypted)


def _sources(name: str, config: dict) -> list[dict]:
    """The system's two sources: one address twice, so a read never runs where a change does."""
    docs = []
    for source in _names(name):
        doc = {
            "kind": "source",
            "name": source,
            "type": "http",
            "baseUrl": config["host"],
            "timeout": TIMEOUT,
            # A refusal reaches the agent in the API's own words.
            "returnFullError": True,
        }
        if config.get("private"):
            doc["allowedIpRanges"] = list(PRIVATE)
        docs.append(doc)
    return docs


def connect(
    name: str, base: str, header: str = "", key: str = "", display_name: str = ""
) -> str:
    """Register a custom API and say so: its entry, its sources and toolsets, the role of its name.

    Its two toolsets are there from now on, empty: an endpoint only joins or leaves one,
    so no role changes when endpoints do. Raises ``ApiError`` with why it was not connected.
    """
    from iblai_ontology.backend import store
    from iblai_ontology.backend.identity import role_source
    from iblai_ontology.backend.mcp_server.toolbox_compat import save_tools_yaml
    from iblai_ontology.backend.services.encryption import encrypt_connection_config
    from iblai_ontology.backend.services.models import Service

    kept, inside = address(base)
    header, key = _header(header, key)
    config = {
        "db_type": "api",
        "host": kept,
        "header": header,
        "api_key": key,
        "private": inside,
    }
    reads, writes = _names(name)
    generator = _generator()
    docs = generator._existing_docs()
    taken = sorted(
        {d.get("name") for d in docs if d.get("kind") in ("source", "toolset")}
        & {reads, writes}
    )
    if taken:
        raise ApiError(
            f"tools.yaml already holds {', '.join(taken)}: name the system something else."
        )
    store.create(
        Service,
        name=name,
        display_name=display_name or name,
        service_type="api",
        adapter=ADAPTER,
        host=kept,
        status=Service.Status.ACTIVE,
        connection_config_encrypted=encrypt_connection_config(config),
    )
    toolsets = [
        {"kind": "toolset", "name": reads, "tools": []},
        {"kind": "toolset", "name": writes, "write": True, "tools": []},
    ]
    report = save_tools_yaml(
        _dump([*docs, *_sources(name, config), *toolsets]), generator.path
    )
    if not report.ok:
        store.delete(Service, name=name)  # nothing half-connected is left behind
        raise ApiError(_errors(report))
    said = f"'{name}' is connected. Add the endpoints agents may call."
    try:
        # The role an agent is connected as: both toolsets, once.
        role_source.extend_role(
            name, {"mcp_toolsets": [reads, writes]}, display_name or name
        )
    except Exception as exc:
        # The system is connected all the same; the role is one to make on Access.
        said += f" No role was made for it: {' '.join(str(exc).split())[:300]}"
    return said


def _endpoint(name: str, doc: dict) -> dict:
    """One tool document as the endpoint it was entered as."""
    method = str(doc.get("method") or "").upper()
    return {
        "name": str(doc.get("name"))[len(name) + 1 :],
        "tool": doc.get("name"),
        "description": doc.get("description") or "",
        "method": method,
        "path": "/" + _ESCAPED.sub(r"{\1}", str(doc.get("path") or "")),
        "query": [p.get("name") for p in doc.get("queryParams") or []],
        "body": bool(doc.get("bodyParams")),
        "write": method != "GET",
    }


def endpoints(name: str) -> list[dict]:
    """The system's endpoints as they were entered, read back from its tools in tools.yaml."""
    docs = _generator()._existing_docs()
    return [_endpoint(name, doc) for doc in docs if _owns(name, doc)]


def _checked(name: str, config: dict, entered: dict, docs: list[dict]) -> dict:
    """An endpoint as it is kept, or why not: one wrong entry stops the whole Toolbox."""
    from iblai_ontology.backend.mcp_server.handlers import BUILTIN_TOOLS

    slug = str(entered.get("name") or "")
    tool = f"{name}-{slug}"
    if not _SLUG.match(slug) or len(tool) > TOOL_NAME_MAX:
        raise ApiError(
            "An endpoint's name is lowercase letters, digits and hyphens, and its tool's "
            f"name ({tool}) {TOOL_NAME_MAX} characters at most."
        )
    others = {
        d.get("name") for d in docs if d.get("kind") == "tool" and not _owns(name, d)
    }
    # query-cache is the gateway's older name for one of its own.
    if tool in others or tool in BUILTIN_TOOLS or tool == "query-cache":
        raise ApiError(
            f"A tool named {tool} exists already: name the endpoint something else."
        )
    method = str(entered.get("method") or "").upper()
    if method not in METHODS:
        raise ApiError(f"An endpoint's method is one of {', '.join(METHODS)}.")
    description = " ".join(str(entered.get("description") or "").split())
    if not description or "${" in description:
        raise ApiError(
            "Say what the endpoint does, without '${': the Toolbox reads that as a "
            "setting of its own."
        )
    path = str(entered.get("path") or "").strip()
    segments = path.strip("/").split("/")
    if (
        not path.startswith("/")
        or not all(_SEGMENT.match(s) for s in segments)
        or any(s in (".", "..") for s in segments)
    ):
        raise ApiError(
            "A path starts with / and holds plain segments and {name} for a value: "
            "/invoices/{invoice_id}/notes"
        )
    body = bool(entered.get("body")) and method in BODIES
    query = [str(q).strip() for q in entered.get("query") or [] if str(q).strip()]
    names = [*dict.fromkeys(_PLACE.findall(path)), *query]
    names += ["body"] if body else []
    names += [config["header"]] if config.get("header") else []
    lowered = [n.lower() for n in names]
    if not all(_QUERY.match(q) for q in query) or len(set(lowered)) != len(lowered):
        raise ApiError(
            "A query name is letters, digits, '_', '.' and '-', and repeats no name in "
            "the path, 'body' or the key's header."
        )
    return {
        "name": slug,
        "description": description,
        "method": method,
        "path": path,
        "query": query,
        "body": body,
    }


def _tool(name: str, config: dict, endpoint: dict) -> dict:
    """An endpoint as the Toolbox's ``http`` tool on the system's source for its kind."""
    reads, writes = _names(name)
    doc = {
        "kind": "tool",
        "name": f"{name}-{endpoint['name']}",
        "type": "http",
        "source": reads if endpoint["method"] == "GET" else writes,
        # The gateway's word: whose key to add to the call.
        "service": name,
        "method": endpoint["method"],
        # Under the address, and each value escaped: a "/" in one stays part of the value.
        "path": _PLACE.sub(r"{{pathEscape .\1}}", endpoint["path"].lstrip("/")),
        "description": endpoint["description"],
    }
    values = list(dict.fromkeys(_PLACE.findall(endpoint["path"])))
    if values:
        doc["pathParams"] = [
            {"name": v, "type": "string", "description": v.replace("_", " ")}
            for v in values
        ]
    if endpoint["query"]:
        doc["queryParams"] = [
            {
                "name": q,
                "type": "string",
                "description": q.replace("_", " "),
                "required": False,
            }
            for q in endpoint["query"]
        ]
    if endpoint["body"]:
        # The Toolbox sends no content type by itself.
        doc["headers"] = {"Content-Type": "application/json"}
        doc["bodyParams"] = [
            {
                "name": "body",
                "type": "map",
                "description": "The JSON body to send, as one object.",
            }
        ]
        doc["requestBody"] = "{{json .body}}"
    if config.get("header"):
        doc["headerParams"] = [
            {
                "name": config["header"],
                "type": "string",
                "description": "Added by the gateway: the system's key.",
            }
        ]
    return doc


def _put(name: str, tool_name: str, tool: dict | None) -> None:
    """Make tools.yaml hold ``tool`` under ``tool_name`` (None: no such tool), listed in its toolset.

    The Toolbox must take the change, or it is undone and ``ApiError`` says why.
    """
    from iblai_ontology.backend.mcp_server.toolbox_compat import save_tools_yaml

    generator = _generator()
    # A tool's source and its toolset share a name.
    home = tool["source"] if tool else None
    kept = []
    for doc in generator._existing_docs():
        if doc.get("kind") == "tool" and doc.get("name") == tool_name:
            continue
        if doc.get("kind") == "toolset" and doc.get("name") in _names(name):
            members = [t for t in doc.get("tools") or [] if t != tool_name]
            if doc.get("name") == home:
                members.append(tool_name)
            doc = {**doc, "tools": members}
        kept.append(doc)
    report = save_tools_yaml(
        _dump([*kept, *([tool] if tool else [])]), generator.path, needs_toolbox=True
    )
    if not report.ok:
        raise ApiError(_errors(report))


def save(service, entered: dict) -> str:
    """Add or change one endpoint and say so; raises ``ApiError`` with why not."""
    config = _config(service)
    endpoint = _checked(service.name, config, entered, _generator()._existing_docs())
    tool = _tool(service.name, config, endpoint)
    _put(service.name, tool["name"], tool)
    return f"{tool['name']} is saved: a role that holds {tool['source']} can call it."


def remove(service, slug: str) -> str:
    """Take one endpoint away and say so; raises ``ApiError`` with why not."""
    tool = f"{service.name}-{slug}"
    if not any(e["tool"] == tool for e in endpoints(service.name)):
        raise ApiError(f"'{service.name}' has no endpoint named {slug}.")
    _put(service.name, tool, None)
    return f"{tool} is removed."


def documents(name: str) -> str:
    """The system's own tools and sources in tools.yaml, as the YAML a removal takes back."""
    own = [
        doc
        for doc in _generator()._existing_docs()
        if _owns(name, doc)
        or (doc.get("kind") == "source" and doc.get("name") in _names(name))
    ]
    return _dump(own)


def signed(spec: dict, source: dict, arguments: dict) -> tuple[dict, str]:
    """A call's arguments with the system's key in its header, and that key.

    The header is the gateway's alone: what the caller sent under it is dropped. The key
    goes only where the registry says the system is, whatever tools.yaml was changed to.
    """
    from iblai_ontology.backend import store
    from iblai_ontology.backend.services.models import Service

    service = store.first(Service, name=spec.get("service"))
    if service is None or service.adapter != ADAPTER:
        raise ApiError(f"{spec.get('name')} names a system that is not connected")
    # ponytail: one registry read a call (a platform request in dm mode); cache it in-process if that shows.
    config = _config(service)
    hidden = {str(p.get("name") or "").lower() for p in spec.get("headerParams") or []}
    kept = {k: v for k, v in arguments.items() if str(k).lower() not in hidden}
    header, key = config.get("header") or "", config.get("api_key") or ""
    if not key:
        return kept, ""
    if source.get("baseUrl") != config.get("host"):
        raise ApiError(
            f"{spec.get('name')} no longer calls {config.get('host')}: "
            "the system's key is sent nowhere else"
        )
    return {**kept, header: key}, key


def without(key: str, answer):
    """An answer with the key masked wherever an API echoed it, whole or after its scheme word."""
    # ponytail: a key under 8 characters is left alone: masking it would mangle ordinary text.
    secrets = {s for s in (key, key.split(" ", 1)[-1]) if len(s) >= 8}
    # The whole value first, so its scheme word goes with it.
    secrets = sorted(secrets, key=len, reverse=True)
    if not secrets:
        return answer
    if isinstance(answer, str):
        for secret in secrets:
            answer = answer.replace(secret, MASK)
        return answer
    text = json.dumps(answer, default=str)
    for secret in secrets:
        text = text.replace(json.dumps(secret)[1:-1], MASK)
    try:
        return json.loads(text)
    except ValueError:
        return text  # the key matched outside a string: the masked text, as it is
