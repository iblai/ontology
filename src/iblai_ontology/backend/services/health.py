"""Per-service connectivity + safety reporting (backs `ontology service status/test`)."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class ConnectivityResult:
    connected: bool
    read_only: bool
    latency_ms: int


@dataclass
class SafetyCheck:
    description: str
    passed: bool


@dataclass
class SafetyReport:
    checks: list[SafetyCheck] = field(default_factory=list)

    @property
    def all_passed(self) -> bool:
        return all(c.passed for c in self.checks)


def _connection_for(service) -> object:
    """Build a DB-API connection for a service from its encrypted config."""
    from iblai_ontology.backend.discovery.engine import create_connection
    from iblai_ontology.backend.services.encryption import decrypt_connection_config

    config = decrypt_connection_config(service.connection_config_encrypted)
    return create_connection(service.adapter, config)


def check_connectivity(service_name: str) -> ConnectivityResult:
    """Connect to a service and time the round-trip; verify read-only posture."""
    import time

    from iblai_ontology.backend.discovery.safety import SafetyVerifier
    from iblai_ontology.backend.services.models import Service

    service = Service.objects.get(name=service_name)
    start = time.time()
    conn = _connection_for(service)
    latency_ms = int((time.time() - start) * 1000)
    try:
        verifier = SafetyVerifier(conn)
        result = verifier.run_all_tests()
        return ConnectivityResult(
            connected=True, read_only=result.all_passed, latency_ms=latency_ms
        )
    finally:
        try:
            conn.close()
        except Exception:  # pragma: no cover - driver dependent
            pass


def full_safety_report(service_name: str) -> SafetyReport:
    """Run the full read-only safety suite and return a per-test report."""
    from iblai_ontology.backend.discovery.safety import SafetyVerifier, TestResult
    from iblai_ontology.backend.services.models import Service

    service = Service.objects.get(name=service_name)
    conn = _connection_for(service)
    try:
        result = SafetyVerifier(conn).run_all_tests()
    finally:
        try:
            conn.close()
        except Exception:  # pragma: no cover
            pass

    report = SafetyReport()
    for t in result.tests:
        report.checks.append(
            SafetyCheck(
                description=f"{t.test_name} blocked",
                passed=(t.result == TestResult.PASSED),
            )
        )
    return report
