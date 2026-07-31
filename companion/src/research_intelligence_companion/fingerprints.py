from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_json(value: Any) -> bytes:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )


def domain_fingerprint(domain: str, value: Any) -> str:
    return hashlib.sha256(domain.encode("utf-8") + b"\0" + canonical_json(value)).hexdigest()


def source_snapshot_fingerprint(source_snapshot: dict[str, str]) -> str:
    return domain_fingerprint("ri-source-snapshot:v1", source_snapshot)


def input_fingerprint(prompt_fingerprint: str, variables: dict[str, str]) -> str:
    return domain_fingerprint(
        "ri-rendered-input:v1",
        {"prompt_fingerprint": prompt_fingerprint, "variables": variables},
    )


def cache_key(
    *,
    operation_id: str,
    prompt_id: str,
    prompt_version: str,
    source_snapshot: dict[str, str],
    provider_type: str,
    model: str,
    parameters: dict[str, int | float],
    output_contract: str,
) -> str:
    return domain_fingerprint(
        "ri-processing-cache:v1",
        {
            "operation_id": operation_id,
            "prompt_id": prompt_id,
            "prompt_version": prompt_version,
            "source_snapshot": source_snapshot,
            "provider_type": provider_type,
            "model": model,
            "parameters": parameters,
            "output_contract": output_contract,
        },
    )


def output_fingerprint(output: dict[str, Any]) -> str:
    return domain_fingerprint("ri-processing-output:v1", output)
