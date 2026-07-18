from __future__ import annotations

import pytest
from pydantic import ValidationError

from research_intelligence_companion.models import HealthResponse


def test_api_response_schema_version_is_required() -> None:
    with pytest.raises(ValidationError):
        HealthResponse(status="ok", companion_version="0.1.0", loopback_only=True)
