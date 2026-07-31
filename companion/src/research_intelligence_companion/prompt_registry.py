from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass


class PromptRegistryError(ValueError):
    pass


@dataclass(frozen=True)
class PromptTemplate:
    prompt_id: str
    version: str
    operation_id: str
    operation_type: str
    title: str
    description: str
    system_template: str
    user_template: str
    variables: tuple[str, ...]
    output_contract: str
    required_capabilities: tuple[str, ...]
    max_input_characters: int

    def registry_payload(self) -> dict[str, object]:
        return {
            "prompt_id": self.prompt_id,
            "version": self.version,
            "operation_id": self.operation_id,
            "operation_type": self.operation_type,
            "title": self.title,
            "description": self.description,
            "system_template": self.system_template,
            "user_template": self.user_template,
            "variables": list(self.variables),
            "output_contract": self.output_contract,
            "required_capabilities": list(self.required_capabilities),
            "max_input_characters": self.max_input_characters,
        }

    @property
    def fingerprint(self) -> str:
        encoded = json.dumps(
            self.registry_payload(), ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        return hashlib.sha256(b"ri-prompt-template:v1\0" + encoded).hexdigest()

    def safe_metadata(self) -> dict[str, object]:
        """Return enough metadata for review without exposing raw prompt text."""
        return {
            "prompt_id": self.prompt_id,
            "version": self.version,
            "operation_id": self.operation_id,
            "operation_type": self.operation_type,
            "title": self.title,
            "description": self.description,
            "variables": list(self.variables),
            "output_contract": self.output_contract,
            "required_capabilities": list(self.required_capabilities),
            "max_input_characters": self.max_input_characters,
            "prompt_fingerprint": self.fingerprint,
        }

    def render(self, variables: dict[str, str]) -> tuple[str, str]:
        if set(variables) != set(self.variables):
            raise PromptRegistryError("Prompt variables do not match the registered allowlist.")
        if any(not isinstance(value, str) or not value for value in variables.values()):
            raise PromptRegistryError("Prompt variables must be non-empty strings.")
        user_message = self.user_template.format(**variables)
        if len(user_message) > self.max_input_characters:
            raise PromptRegistryError("Prompt input exceeds the registered limit.")
        return self.system_template, user_message


PROMPT_REGISTRY: tuple[PromptTemplate, ...] = (
    PromptTemplate(
        prompt_id="task5b.provider_echo_test",
        version="1.0.0",
        operation_id="provider_echo_test",
        operation_type="provider_echo_test",
        title="Synthetic provider processing test",
        description=(
            "A fixed acknowledgement used to verify local processing, caching and provenance."
        ),
        system_template="Return the fixed acknowledgement object only.",
        user_template="Synthetic processing input version: {synthetic_input_version}.",
        variables=("synthetic_input_version",),
        output_contract="task5b.provider_echo_ack.v1",
        required_capabilities=("generation", "structured_output"),
        max_input_characters=120,
    ),
)

_BY_ID = {template.prompt_id: template for template in PROMPT_REGISTRY}


def get_prompt(prompt_id: str) -> PromptTemplate:
    try:
        return _BY_ID[prompt_id]
    except KeyError as exc:
        raise PromptRegistryError("The requested prompt is not registered.") from exc


def get_operation_prompt(operation_id: str) -> PromptTemplate:
    matches = [template for template in PROMPT_REGISTRY if template.operation_id == operation_id]
    if len(matches) != 1:
        raise PromptRegistryError("The requested processing operation is not registered.")
    return matches[0]


def prompt_metadata() -> list[dict[str, object]]:
    return [template.safe_metadata() for template in PROMPT_REGISTRY]


def registry_fingerprint() -> str:
    payload = [template.registry_payload() for template in PROMPT_REGISTRY]
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
        "utf-8"
    )
    return hashlib.sha256(b"ri-prompt-registry:v1\0" + encoded).hexdigest()
