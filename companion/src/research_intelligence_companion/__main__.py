from __future__ import annotations

import argparse
import json

import uvicorn

from research_intelligence_companion import __version__
from research_intelligence_companion.security import SecurityError, validate_bind_host
from research_intelligence_companion.settings import CompanionSettings


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the Research Intelligence local companion.")
    parser.add_argument(
        "--check",
        action="store_true",
        help="Validate packaging/runtime metadata and exit.",
    )
    parser.add_argument("--host", default=None, help="Loopback host to bind.")
    parser.add_argument("--port", default=None, type=int, help="Port to bind.")
    args = parser.parse_args()

    settings = CompanionSettings.from_env()
    host = args.host or settings.host
    port = args.port or settings.port
    try:
        validate_bind_host(host)
    except SecurityError as exc:
        raise SystemExit(str(exc)) from exc

    if args.check:
        print(json.dumps({"status": "ok", "version": __version__, "loopback_host": host}))
        return

    uvicorn.run(
        "research_intelligence_companion.app:create_app",
        factory=True,
        host=host,
        port=port,
    )


if __name__ == "__main__":
    main()
