"""Microsoft Entra ID token validation (Component 3).

Validates the Entra ID access token forwarded by the ibl.ai platform: signature
against the tenant JWKS, plus audience / issuer / expiry checks. The JWKS client
is injectable so this is unit-testable without network access.

This is intentionally Django-free; the gateway middleware wires it to settings.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Optional

import jwt


@dataclass
class EntraIdentity:
    user_id: str  # oid
    email: str
    name: str
    roles: list[str]
    groups: list[str]
    token_jti: Optional[str]
    token_exp: Optional[int]  # unix seconds; bounds the replay-store TTL
    raw_claims: dict[str, Any]


class EntraTokenError(Exception):
    """Raised when an Entra ID token fails validation."""


def jwks_url(tenant_id: str) -> str:
    return f"https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys"


def issuer(tenant_id: str) -> str:
    return f"https://login.microsoftonline.com/{tenant_id}/v2.0"


class EntraValidator:
    """Validates Entra ID JWTs for a single tenant + application (audience)."""

    def __init__(
        self,
        tenant_id: str,
        client_id: str,
        *,
        jwks_client: Any | None = None,
        algorithms: tuple[str, ...] = ("RS256",),
    ) -> None:
        if not tenant_id or not client_id:
            raise ValueError(
                "tenant_id and client_id are required for Entra validation"
            )
        self.tenant_id = tenant_id
        self.client_id = client_id
        self.algorithms = list(algorithms)
        self._jwks_client = jwks_client or jwt.PyJWKClient(jwks_url(tenant_id))

    def validate(self, token: str) -> EntraIdentity:
        try:
            signing_key = self._jwks_client.get_signing_key_from_jwt(token)
            claims = jwt.decode(
                token,
                signing_key.key,
                algorithms=self.algorithms,
                audience=f"api://{self.client_id}",
                issuer=issuer(self.tenant_id),
                # jti is required so every accepted token is replay-trackable
                # (see identity.replay); a token without one cannot be bound to
                # a first-seen sender and is rejected here.
                options={"require": ["exp", "iss", "aud", "sub", "jti"]},
            )
        except jwt.ExpiredSignatureError as exc:
            raise EntraTokenError("token expired") from exc
        except jwt.InvalidAudienceError as exc:
            raise EntraTokenError("invalid audience") from exc
        except jwt.InvalidIssuerError as exc:
            raise EntraTokenError("invalid issuer") from exc
        except jwt.PyJWTError as exc:
            raise EntraTokenError(f"token validation failed: {exc}") from exc

        return EntraIdentity(
            user_id=claims.get("oid") or claims.get("sub"),
            email=claims.get("preferred_username") or claims.get("email", ""),
            name=claims.get("name", ""),
            roles=claims.get("roles", []) or [],
            groups=claims.get("groups", []) or [],
            token_jti=claims.get("jti"),
            token_exp=claims.get("exp"),
            raw_claims=claims,
        )
