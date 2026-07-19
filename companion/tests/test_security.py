from __future__ import annotations

import pytest

from research_intelligence_companion.security import SecurityError, validate_bind_host


def test_remote_interface_binding_is_disallowed() -> None:
    with pytest.raises(SecurityError):
        validate_bind_host("0.0.0.0")  # noqa: S104 - verify wildcard bind rejection.


def test_loopback_binding_is_allowed() -> None:
    assert validate_bind_host("127.0.0.1") == "127.0.0.1"
