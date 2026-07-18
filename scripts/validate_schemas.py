from __future__ import annotations

import json
from pathlib import Path

from jsonschema.validators import Draft202012Validator


SCHEMA_ROOT = Path("packages/schemas")
EXPECTED_DRAFT = "https://json-schema.org/draft/2020-12/schema"


def main() -> None:
    schema_paths = sorted(SCHEMA_ROOT.glob("*.schema.json"))
    if not schema_paths:
        raise SystemExit("No JSON Schema files found.")

    for schema_path in schema_paths:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
        if schema.get("$schema") != EXPECTED_DRAFT:
            raise SystemExit(f"{schema_path}: expected {EXPECTED_DRAFT}")
        if "schema_version" not in schema.get("required", []):
            raise SystemExit(f"{schema_path}: schema_version must be required")
        Draft202012Validator.check_schema(schema)
        print(f"draft2020-12 ok: {schema_path}")

    print(f"validated {len(schema_paths)} schemas")


if __name__ == "__main__":
    main()
