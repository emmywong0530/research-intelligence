from __future__ import annotations

import os
from dataclasses import dataclass, field

DEFAULT_ALLOWED_ORIGINS = (
    "http://127.0.0.1:5173",
    "http://localhost:5173",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
)


@dataclass(frozen=True)
class CompanionSettings:
    host: str = "127.0.0.1"
    port: int = 8765
    allowed_origins: tuple[str, ...] = field(default_factory=lambda: DEFAULT_ALLOWED_ORIGINS)

    @classmethod
    def from_env(cls) -> CompanionSettings:
        origins = os.getenv("RI_ALLOWED_ORIGINS")
        allowed_origins = (
            tuple(origin.strip() for origin in origins.split(",") if origin.strip())
            if origins
            else DEFAULT_ALLOWED_ORIGINS
        )
        return cls(
            host=os.getenv("RI_HOST", "127.0.0.1"),
            port=int(os.getenv("RI_PORT", "8765")),
            allowed_origins=allowed_origins,
        )
