"""A server installed with no platform: the frontend sets it up once, with the code its install printed.

``ONTOLOGY_SETUP_CODE`` marks such a server. Until an administrator opens the link and
chooses a platform it has none: the console and the gateway refuse, and only ``/setup``
answers. Setting it up keeps the platform, and a platform API key made in that
administrator's name, as one row of this host's own database; the key is encrypted like a
connected system's login. A backend with no code takes its platform and its key from its
environment (``IBLAI_ORG``, ``IBLAI_ADMIN_TOKEN``) and nothing here applies to it.
"""

from __future__ import annotations

import hmac
import os
import re
import time
from datetime import datetime, timezone

KIND, KEY = "server", "platform"  # the one row: this server's platform and its key
KEYS = "/api/core/platform/api-tokens/"
_PLATFORM = re.compile(r"[A-Za-z0-9_.-]+")


class SetupRefused(RuntimeError):
    """Why this server was not set up, in words for the frontend."""


def server_code() -> str:
    """The one-time code of a server installed with no platform; "" for any other backend."""
    return (os.environ.get("ONTOLOGY_SETUP_CODE") or "").strip()


def held() -> dict:
    """What setting this server up kept: its platform, its key (encrypted) and who did it."""
    if not server_code():
        return {}
    from django.apps import apps

    # A command that never started the backend has no database to read.
    if not apps.ready:
        return {}
    from iblai_ontology.backend.services.models import Record

    row = Record.objects.filter(kind=KIND, key=KEY).first()
    return row.data if row else {}


def platform() -> str:
    """This backend's platform, by key: its environment's, else the one it was set up for."""
    from django.conf import settings

    return settings.IBLAI_ORG or held().get("platform", "")


def admin_platforms() -> set[str]:
    """The platforms whose admins the console trusts; a server set up from the frontend trusts its own."""
    from django.conf import settings

    listed = settings.ONTOLOGY_ADMIN_PLATFORMS
    if listed or not server_code():
        return listed
    own = platform()
    return {own} if own else set()


def pending() -> bool:
    """Whether this server still waits to be set up: it has a code and no platform yet."""
    return bool(server_code()) and not platform()


def credentials() -> tuple[str, str]:
    """The platform and the platform API key this server was set up with; "" for what it lacks."""
    kept = held()
    if not kept.get("key"):
        return kept.get("platform", ""), ""
    from iblai_ontology.backend.services.encryption import decrypt_connection_config

    return kept.get("platform", ""), decrypt_connection_config(kept["key"].encode())[
        "key"
    ]


def _sign_in(authorization: str) -> str:
    """The administrator's own ibl.ai sign-in out of the header it came in."""
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "token" or not token.strip():
        raise SetupRefused(
            "Setting a server up needs your ibl.ai sign-in: the platform lets only a "
            "signed-in administrator make a key."
        )
    return token.strip()


def _administrator(token: str, org: str) -> str:
    """The caller's username, once the platform says they administer ``org``; never cached."""
    from iblai_ontology.backend.api import auth

    try:
        who = auth._ask_platform("Token", token, org)
    except auth.CredentialRejected as exc:
        raise SetupRefused(
            f"The ibl.ai platform does not take your sign-in: {exc}"
        ) from exc
    except auth.PlatformSilent as exc:
        raise SetupRefused(f"The ibl.ai platform did not answer: {exc}") from exc
    if not who.admin_here:
        raise SetupRefused(f"Only an administrator of {org} sets up its backend.")
    return who.username


def _ready(token: str, org: str) -> None:
    """Refuse unless the sign-in is ``org``'s own and its administrators can grant ontology roles."""
    import httpx
    from django.conf import settings

    from iblai_ontology.backend.api import auth
    from iblai_ontology.backend.identity.role_source import ALL_VERBS, ROOT

    try:
        resp = httpx.get(
            settings.ONTOLOGY_DM_URL + auth.DM_GRANTS_PATH,
            params={"resource_paths": ROOT},
            headers={"Authorization": f"Token {token}", "iblai-org": org},
            timeout=auth.HTTP_TIMEOUT,
        )
        body = resp.json() if resp.status_code == 200 else None
    except (httpx.HTTPError, ValueError) as exc:
        raise SetupRefused(f"The ibl.ai platform did not answer: {exc}") from exc
    if resp.status_code != 200:
        words = auth._words(resp)
        if "iblai-org" in words:
            # A key is made in the platform of the sign-in that asks for it.
            raise SetupRefused(
                f"Your sign-in is for another platform than {org}: switch to {org}, "
                "then set the server up."
            )
        raise SetupRefused(
            f"The ibl.ai platform refused your sign-in for {org}: {words}"
        )
    grants = body.get(ROOT) if isinstance(body, dict) else None
    actions = grants.get("actions") if isinstance(grants, dict) else None
    if not {"*", ALL_VERBS} & set(actions or []):
        raise SetupRefused(
            f"The administrators of {org} cannot grant ontology roles yet: its RBAC has "
            f"no custom namespace for them. Ask ibl.ai to enable it for {org}, then open "
            "the link again."
        )


def _make_key(token: str) -> tuple[str, str, str]:
    """A platform API key that acts as the caller: the key, its id in the platform, its name."""
    import httpx
    from django.conf import settings

    from iblai_ontology.backend.api import auth

    # A name is one key's in its platform.
    name = f"ontology-backend-{int(time.time()):x}"
    try:
        resp = httpx.post(
            settings.ONTOLOGY_DM_URL + KEYS,
            # No mode, so the key acts as its owner.
            json={"name": name},
            headers={"Authorization": f"Token {token}"},
            timeout=auth.HTTP_TIMEOUT,
        )
        made = resp.json() if resp.status_code in (200, 201) else None
    except (httpx.HTTPError, ValueError) as exc:
        raise SetupRefused(f"The ibl.ai platform did not answer: {exc}") from exc
    if not isinstance(made, dict) or not made.get("key"):
        raise SetupRefused(f"The ibl.ai platform made no key: {auth._words(resp)}")
    return made["key"], str(made.get("unique_id") or ""), name


def _key_works() -> bool:
    """Whether the platform still takes the key this server calls it with."""
    from iblai_ontology.backend.api import auth
    from iblai_ontology.backend.platform.client import PlatformConfig

    try:
        config = PlatformConfig.from_env()
    except RuntimeError:  # it holds none
        return False
    try:
        auth.platform_grants(config.auth_scheme, config.admin_token)
    except auth.CredentialRejected:
        return False
    except auth.PlatformSilent as exc:
        raise SetupRefused(f"The ibl.ai platform did not answer: {exc}") from exc
    return True


def set_up(authorization: str, *, named: str = "", code: str = "") -> dict:
    """Give this server its platform and its key; returns ``{"message", "by", "changed"}``.

    One that waits takes its code and an administrator of the platform ``named``. One that
    is set up takes its own platform's administrators, and makes a new key only when the
    platform refuses the one it holds. A backend with no code has nothing to set up.
    """
    from django.conf import settings
    from django.core.cache import cache
    from django.db import IntegrityError, transaction

    from iblai_ontology.backend.services.encryption import encrypt_connection_config
    from iblai_ontology.backend.services.models import Record

    if not server_code():
        return {"message": "", "by": "", "changed": False}
    if not settings.ONTOLOGY_DM_URL:
        raise SetupRefused(
            "This server does not know the ibl.ai platform's address (ONTOLOGY_DM_URL)."
        )
    token = _sign_in(authorization)
    first = pending()
    if first:
        if not code or not hmac.compare_digest(code.encode(), server_code().encode()):
            raise SetupRefused(
                "This server is not set up yet, and that is not its code: open the link "
                "its install printed, or run the install command again to print it."
            )
        if not _PLATFORM.fullmatch(named):
            raise SetupRefused("Choose the platform this server is for.")
        own = named
    else:
        own = platform()
        if named and named != own:
            raise SetupRefused(f"This server belongs to another platform than {named}.")
    by = _administrator(token, own)
    if not first and _key_works():
        return {
            "message": f"This server is set up for {own}.",
            "by": by,
            "changed": False,
        }
    _ready(token, own)
    key, key_id, name = _make_key(token)
    row = {
        "platform": own,
        # Encrypted like a connected system's login: ONTOLOGY_CREDENTIAL_KEY reads it back.
        "key": encrypt_connection_config({"key": key}).decode(),
        "key_id": key_id,
        "by": by,
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    if first:
        try:
            with transaction.atomic():
                Record.objects.create(kind=KIND, key=KEY, data=row)
        except IntegrityError as exc:
            # Two callers at once: the first one's platform stands.
            raise SetupRefused(
                "This server was set up a moment ago by someone else. The key just made "
                f"in your name ({name}) is unused: delete it in your platform."
            ) from exc
    else:
        Record.objects.update_or_create(kind=KIND, key=KEY, defaults={"data": row})
    # What was judged before there was a platform, or with the old key, is asked again.
    cache.clear()
    return {"message": f"This server is set up for {own}.", "by": by, "changed": True}
