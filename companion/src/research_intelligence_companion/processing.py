from __future__ import annotations

import asyncio
import json
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .ai_provider import (
    GenerationRequest,
    ProviderGenerationError,
    ProviderRuntime,
)
from .fingerprints import (
    cache_key,
    input_fingerprint,
    output_fingerprint,
    source_snapshot_fingerprint,
)
from .paper_summary import (
    SUMMARY_OPERATION_ID,
    SUMMARY_OUTPUT_CONTRACT,
    PaperSummarySource,
    PaperSummarySourceError,
    prepare_paper_summary_source,
    validate_summary_output,
)
from .prompt_registry import PromptRegistryError, get_operation_prompt
from .workspace import (
    WorkspaceConflictError,
    WorkspaceError,
    list_records,
    read_record,
    write_record,
)

PROCESSING_SCHEMA_VERSION = "m5b.v1"
PROCESSING_OPERATION_ID = "provider_echo_test"
PROCESSING_PROVIDER_TYPE = "fake"
PROCESSING_MODEL_DEFAULT = "gpt-4o-mini"
PROCESSING_PARAMETERS = {"temperature": 0.0, "max_output_tokens": 64}
SUMMARY_PARAMETERS = {"temperature": 0.2, "max_output_tokens": 512}


def _timestamp() -> str:
    return datetime.now(tz=UTC).isoformat().replace("+00:00", "Z")


class ProcessingError(ValueError):
    def __init__(self, code: str, message: str, *, status_code: int = 400) -> None:
        self.code = code
        self.status_code = status_code
        super().__init__(message)


def _safe_output(source_version: str, output: dict[str, object] | None) -> dict[str, object]:
    expected = {
        "contract_id": "task5b.provider_echo_ack.v1",
        "acknowledgement": "Synthetic provider processing completed.",
        "synthetic_input_version": source_version,
    }
    if output != expected:
        raise ProcessingError(
            "invalid_output",
            "The synthetic provider returned an output outside the registered contract.",
        )
    return expected


class ProcessingEngine:
    """Small in-process scheduler for explicit synthetic processing only."""

    def __init__(self, runtime: ProviderRuntime) -> None:
        self.runtime = runtime
        self.executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ri-processing")
        self.lock = threading.RLock()
        self.active: dict[str, tuple[str, threading.Event]] = {}

    def operations(self) -> list[dict[str, object]]:
        if not self.runtime.test_mode:
            raise ProcessingError(
                "processing_unavailable", "Synthetic processing is test-only.", status_code=404
            )
        prompt = get_operation_prompt(PROCESSING_OPERATION_ID)
        return [
            {
                "operation_id": prompt.operation_id,
                "operation_type": prompt.operation_type,
                "title": prompt.title,
                "description": prompt.description,
                "prompt_id": prompt.prompt_id,
                "prompt_version": prompt.version,
                "output_contract": prompt.output_contract,
                "required_capabilities": list(prompt.required_capabilities),
                "source_type": "synthetic",
                "availability": "test_only",
            }
        ]

    def prompts(self) -> list[dict[str, object]]:
        if not self.runtime.test_mode:
            raise ProcessingError(
                "processing_unavailable", "Synthetic processing is test-only.", status_code=404
            )
        from .prompt_registry import prompt_metadata

        return prompt_metadata()

    def _summary_context(
        self, root: Path, project_id: str, paper_id: str
    ) -> tuple[PaperSummarySource, Any, Any, str, str, str, str]:
        try:
            source = prepare_paper_summary_source(root, project_id, paper_id)
            prompt = get_operation_prompt(SUMMARY_OPERATION_ID)
            system_message, user_message = prompt.render({"summary_input": source.summary_input})
        except PaperSummarySourceError as exc:
            raise ProcessingError(exc.code, str(exc), status_code=exc.status_code) from exc
        except PromptRegistryError as exc:
            raise ProcessingError("prompt_unavailable", str(exc), status_code=503) from exc
        config = self.runtime.store.read()
        if config is None or not config.enabled:
            raise ProcessingError(
                "provider_not_ready",
                "Configure an enabled provider before requesting a paper summary.",
            )
        if (
            not self.runtime.test_mode
            and self.runtime.credential_state(config.provider) != "present"
        ):
            raise ProcessingError(
                "provider_not_ready",
                "Store a provider credential before requesting a paper summary.",
            )
        provider_type = "fake" if self.runtime.test_mode else "openai"
        input_hash = input_fingerprint(prompt.fingerprint, {"summary_input": source.summary_input})
        key = cache_key(
            operation_id=prompt.operation_id,
            prompt_id=prompt.prompt_id,
            prompt_version=prompt.version,
            source_snapshot=source.source_snapshot,
            provider_type=provider_type,
            model=config.model,
            parameters=SUMMARY_PARAMETERS,
            output_contract=prompt.output_contract,
        )
        return source, prompt, config, system_message, user_message, key, input_hash

    def summary_preflight(self, root: Path, project_id: str, paper_id: str) -> dict[str, object]:
        try:
            source, _prompt, config, _system, _user, key, _input_hash = self._summary_context(
                root, project_id, paper_id
            )
        except ProcessingError as exc:
            return {
                "eligible": False,
                "reason_code": exc.code,
                "message": str(exc),
                "project_id": project_id,
                "paper_id": paper_id,
            }
        cache_record = next(
            (
                item["record"]
                for item in reversed(self.list_summary_records(root, project_id, paper_id))
                if item["record"].get("cache_key") == key
                and item["record"].get("status") == "completed"
                and not item["record"].get("stale")
                and not item["record"].get("invalidated")
            ),
            None,
        )
        snapshot = source.source_snapshot
        return {
            "eligible": True,
            "reason_code": None,
            "message": "Ready for explicit confirmation.",
            "project_id": project_id,
            "paper_id": paper_id,
            "title": source.title,
            "source_type": "local_extracted_text",
            "source_sha256": snapshot["source_sha256"],
            "extraction_id": snapshot["extraction_id"],
            "extraction_status": snapshot["extraction_status"],
            "page_count": snapshot["page_count"],
            "included_page_count": snapshot["included_page_count"],
            "included_characters": snapshot["included_characters"],
            "truncated": snapshot["truncated"],
            "metadata_fields": list(source.metadata_fields),
            "provider": "openai-compatible",
            "model": config.model,
            "cache_available": cache_record is not None,
            "cached_processing_id": cache_record.get("processing_id") if cache_record else None,
        }

    def list_summary_records(
        self, root: Path, project_id: str, paper_id: str
    ) -> list[dict[str, object]]:
        records = list_records(root, "processing", project_id=project_id, paper_id=paper_id)
        return [
            item
            for item in records
            if item["record"].get("operation_id") == SUMMARY_OPERATION_ID
        ]

    def start_paper_summary(
        self,
        root: Path,
        workspace_id: str,
        project_id: str,
        paper_id: str,
        *,
        expected_paper_revision: str | None = None,
        retry_of: dict[str, object] | None = None,
    ) -> dict[str, object]:
        if expected_paper_revision is not None:
            _paper, current_revision, _ = read_record(root, "papers", paper_id)
            if current_revision != expected_paper_revision:
                raise ProcessingError(
                    "stale_revision",
                    "The paper changed before the summary could start; reload it before retrying.",
                    status_code=409,
                )
        source, prompt, config, system_message, user_message, key, input_hash = (
            self._summary_context(root, project_id, paper_id)
        )
        self._mark_summary_stale(
            root,
            project_id,
            paper_id,
            source_snapshot_fingerprint(source.source_snapshot),
        )
        with self.lock:
            active = self.active.get(key)
            if active is not None:
                existing, _, _ = read_record(root, "processing", active[0])
                return {"record": existing, "reused_active": True}
        for item in reversed(self.list_summary_records(root, project_id, paper_id)):
            record = item["record"]
            if (
                record.get("cache_key") == key
                and record.get("status") == "completed"
                and not record.get("stale")
                and not record.get("invalidated")
                and record.get("output") is not None
            ):
                processing_id = f"processing_{uuid.uuid4().hex}"
                event = self._record(
                    workspace_id=workspace_id,
                    processing_id=processing_id,
                    model=config.model,
                    prompt=prompt,
                    source_version=None,
                    source_snapshot=source.source_snapshot,
                    input_hash=input_hash,
                    key=key,
                    status="completed",
                    cache_disposition="cache_hit",
                    now=_timestamp(),
                    original_processing_id=str(record["processing_id"]),
                    output=record["output"],
                    output_hash=record.get("output_fingerprint"),
                    usage=record.get("usage"),
                    parameters=SUMMARY_PARAMETERS,
                    provider_type="fake" if self.runtime.test_mode else "openai",
                    project_id=project_id,
                    paper_id=paper_id,
                )
                saved, *_ = write_record(
                    root, "processing", processing_id, event, expected_revision=None
                )
                return {"record": saved, "reused_active": False}
        attempt_count = int(retry_of.get("attempt_count", 0)) + 1 if retry_of else 1
        if attempt_count > 3:
            raise ProcessingError(
                "retry_limit", "The bounded summary retry limit has been reached."
            )
        processing_id = f"processing_{uuid.uuid4().hex}"
        event = self._record(
            workspace_id=workspace_id,
            processing_id=processing_id,
            model=config.model,
            prompt=prompt,
            source_version=None,
            source_snapshot=source.source_snapshot,
            input_hash=input_hash,
            key=key,
            status="queued",
            cache_disposition="cache_miss",
            now=_timestamp(),
            retry_of_processing_id=str(retry_of["processing_id"]) if retry_of else None,
            attempt_count=attempt_count,
            parameters=SUMMARY_PARAMETERS,
            provider_type="fake" if self.runtime.test_mode else "openai",
            project_id=project_id,
            paper_id=paper_id,
        )
        saved, *_ = write_record(root, "processing", processing_id, event, expected_revision=None)
        cancel_event = threading.Event()
        with self.lock:
            self.active[key] = (processing_id, cancel_event)
        self.executor.submit(
            self._run_summary,
            root,
            processing_id,
            key,
            system_message,
            user_message,
            cancel_event,
        )
        return {"record": saved, "reused_active": False}

    def _mark_summary_stale(
        self, root: Path, project_id: str, paper_id: str, snapshot_hash: str
    ) -> None:
        for item in self.list_summary_records(root, project_id, paper_id):
            record = item["record"]
            if (
                record.get("source_snapshot_fingerprint") != snapshot_hash
                and not record.get("stale")
            ):
                updated = json.loads(json.dumps(record))
                updated["stale"] = True
                updated["updated_at"] = _timestamp()
                try:
                    write_record(
                        root,
                        "processing",
                        str(record["processing_id"]),
                        updated,
                        expected_revision=str(item["revision"]),
                    )
                except WorkspaceConflictError:
                    continue

    def _run_summary(
        self,
        root: Path,
        processing_id: str,
        key: str,
        system_message: str,
        user_message: str,
        cancel_event: threading.Event,
    ) -> None:
        try:
            with self.lock:
                record, revision, _ = read_record(root, "processing", processing_id)
                if cancel_event.is_set() or record.get("status") == "cancelled":
                    return
                running = json.loads(json.dumps(record))
                running["status"] = "running"
                running["started_at"] = _timestamp()
                running["updated_at"] = running["started_at"]
                running["error"] = None
                if self._update(root, processing_id, running, revision) is None:
                    return
            request = GenerationRequest(
                operation_id=SUMMARY_OPERATION_ID,
                model=str(record["model"]),
                system_message=system_message,
                user_message=user_message,
                temperature=float(record["parameters"]["temperature"]),
                max_output_tokens=int(record["parameters"]["max_output_tokens"]),
                output_contract=SUMMARY_OUTPUT_CONTRACT,
                timeout_seconds=30,
            )
            try:
                result = asyncio.run(self.runtime.generate(request))
                output = validate_summary_output(result.structured_output)
                error = None
                status = "completed"
            except PaperSummarySourceError as exc:
                output = None
                error = {"category": exc.code, "message": str(exc)}
                status = "failed"
                result = None
            except ProviderGenerationError as exc:
                output = None
                error = {"category": exc.category, "message": exc.message}
                status = "failed"
                result = None
            if cancel_event.is_set():
                status = "cancelled"
                output = None
                error = {
                    "category": "cancelled",
                    "message": "The paper summary was cancelled before completion.",
                }
            finished = json.loads(json.dumps(running))
            finished["status"] = status
            finished["completed_at"] = _timestamp()
            finished["updated_at"] = finished["completed_at"]
            finished["output"] = output
            finished["output_fingerprint"] = output_fingerprint(output) if output else None
            finished["usage"] = (
                {"input_tokens": result.input_tokens, "output_tokens": result.output_tokens}
                if result
                else None
            )
            finished["error"] = error
            finished["provenance"]["recorded_at"] = finished["updated_at"]
            with self.lock:
                current, current_revision, _ = read_record(root, "processing", processing_id)
                if cancel_event.is_set() or current.get("status") == "cancelled":
                    return
                self._update(root, processing_id, finished, current_revision)
        except (OSError, WorkspaceError, ValueError):
            try:
                with self.lock:
                    current, revision, _ = read_record(root, "processing", processing_id)
                    if current.get("status") == "cancelled":
                        return
                    failed = json.loads(json.dumps(current))
                    failed["status"] = "failed"
                    failed["completed_at"] = _timestamp()
                    failed["updated_at"] = failed["completed_at"]
                    failed["error"] = {
                        "category": "unexpected_provider_error",
                        "message": "The paper summary failed before a result was saved.",
                    }
                    self._update(root, processing_id, failed, revision)
            except Exception:  # noqa: BLE001 - best-effort durable error reporting.
                return
        finally:
            with self.lock:
                current = self.active.get(key)
                if current and current[0] == processing_id:
                    self.active.pop(key, None)

    def retry_paper_summary(
        self, root: Path, workspace_id: str, project_id: str, paper_id: str, processing_id: str
    ) -> dict[str, object]:
        record, _, _ = read_record(root, "processing", processing_id)
        if (
            record.get("operation_id") != SUMMARY_OPERATION_ID
            or record.get("project_id") != project_id
            or record.get("paper_id") != paper_id
        ):
            raise ProcessingError(
                "record_scope_mismatch",
                "The processing record is not for this paper.",
                status_code=403,
            )
        if record.get("status") not in {"failed", "cancelled"}:
            raise ProcessingError(
                "invalid_state", "Only failed or cancelled summaries can be retried."
            )
        return self.start_paper_summary(
            root,
            workspace_id,
            project_id,
            paper_id,
            retry_of=record,
        )

    def _record(
        self,
        *,
        workspace_id: str,
        processing_id: str,
        model: str,
        prompt: Any,
        source_version: str | None,
        input_hash: str,
        key: str,
        status: str,
        cache_disposition: str,
        now: str,
        original_processing_id: str | None = None,
        retry_of_processing_id: str | None = None,
        attempt_count: int = 1,
        output: dict[str, object] | None = None,
        output_hash: str | None = None,
        usage: dict[str, int] | None = None,
        error: dict[str, str] | None = None,
        source_snapshot: dict[str, object] | None = None,
        parameters: dict[str, int | float] | None = None,
        provider_type: str | None = None,
        project_id: str | None = None,
        paper_id: str | None = None,
    ) -> dict[str, object]:
        source_snapshot = source_snapshot or {
            "source_type": "synthetic",
            "synthetic_input_version": source_version,
        }
        parameters = parameters or PROCESSING_PARAMETERS
        provider_type = provider_type or PROCESSING_PROVIDER_TYPE
        provenance: dict[str, object] = {
            "provenance_type": "ai_processing",
            "operation_id": prompt.operation_id,
            "prompt_id": prompt.prompt_id,
            "prompt_version": prompt.version,
            "prompt_fingerprint": prompt.fingerprint,
            "provider_type": provider_type,
            "model": model,
            "parameters": parameters,
            "input_fingerprint": input_hash,
            "source_type": source_snapshot["source_type"],
            "cache_key": key,
            "cache_disposition": cache_disposition,
            "recorded_at": now,
        }
        if original_processing_id:
            provenance["original_processing_id"] = original_processing_id
        return {
            "schema_version": PROCESSING_SCHEMA_VERSION,
            "processing_id": processing_id,
            "workspace_id": workspace_id,
            "operation_id": prompt.operation_id,
            "operation_type": prompt.operation_type,
            "prompt_id": prompt.prompt_id,
            "prompt_version": prompt.version,
            "prompt_fingerprint": prompt.fingerprint,
            "provider_type": provider_type,
            "model": model,
            "parameters": parameters,
            "input_fingerprint": input_hash,
            "source_snapshot": source_snapshot,
            "source_snapshot_fingerprint": source_snapshot_fingerprint(source_snapshot),
            "cache_key": key,
            "cache_disposition": cache_disposition,
            **(
                {"original_processing_id": original_processing_id}
                if original_processing_id
                else {}
            ),
            **(
                {"retry_of_processing_id": retry_of_processing_id}
                if retry_of_processing_id
                else {}
            ),
            "status": status,
            "requested_at": now,
            "started_at": None,
            "completed_at": now if status in {"completed", "failed", "cancelled"} else None,
            "updated_at": now,
            "attempt_count": attempt_count,
            "output": output,
            "output_fingerprint": output_hash,
            "usage": usage,
            "provenance": provenance,
            "error": error,
            "stale": False,
            "invalidated": False,
            **({"project_id": project_id} if project_id else {}),
            **({"paper_id": paper_id} if paper_id else {}),
        }

    def _mark_stale(self, root: Path, source_version: str) -> None:
        for item in list_records(root, "processing"):
            record = item["record"]
            if (
                record.get("operation_id") == PROCESSING_OPERATION_ID
                and record.get("source_snapshot", {}).get("synthetic_input_version")
                != source_version
                and not record.get("stale")
            ):
                updated = json.loads(json.dumps(record))
                updated["stale"] = True
                updated["updated_at"] = _timestamp()
                try:
                    write_record(
                        root,
                        "processing",
                        str(record["processing_id"]),
                        updated,
                        expected_revision=str(item["revision"]),
                    )
                except WorkspaceConflictError:
                    continue

    def start(
        self,
        root: Path,
        workspace_id: str,
        *,
        source_version: str,
        retry_of: dict[str, object] | None = None,
    ) -> dict[str, object]:
        if not self.runtime.test_mode:
            raise ProcessingError(
                "processing_unavailable", "Synthetic processing is test-only.", status_code=404
            )
        try:
            prompt = get_operation_prompt(PROCESSING_OPERATION_ID)
            system_message, user_message = prompt.render(
                {"synthetic_input_version": source_version}
            )
        except PromptRegistryError as exc:
            raise ProcessingError("prompt_unavailable", str(exc), status_code=503) from exc
        config = self.runtime.store.read()
        if config is None or not config.enabled:
            raise ProcessingError(
                "provider_not_ready",
                "Configure an enabled provider before starting the synthetic processing test.",
            )
        input_hash = input_fingerprint(
            prompt.fingerprint, {"synthetic_input_version": source_version}
        )
        key = cache_key(
            operation_id=prompt.operation_id,
            prompt_id=prompt.prompt_id,
            prompt_version=prompt.version,
            source_snapshot={"source_type": "synthetic", "synthetic_input_version": source_version},
            provider_type=PROCESSING_PROVIDER_TYPE,
            model=config.model,
            parameters=PROCESSING_PARAMETERS,
            output_contract=prompt.output_contract,
        )
        self._mark_stale(root, source_version)
        with self.lock:
            active = self.active.get(key)
            if active is not None:
                existing, _, _ = read_record(root, "processing", active[0])
                return {"record": existing, "reused_active": True}
        items = list_records(root, "processing")
        for item in reversed(items):
            record = item["record"]
            if (
                record.get("cache_key") == key
                and record.get("status") == "completed"
                and not record.get("stale")
                and not record.get("invalidated")
                and record.get("output") is not None
            ):
                now = _timestamp()
                processing_id = f"processing_{uuid.uuid4().hex}"
                event = self._record(
                    workspace_id=workspace_id,
                    processing_id=processing_id,
                    model=config.model,
                    prompt=prompt,
                    source_version=source_version,
                    input_hash=input_hash,
                    key=key,
                    status="completed",
                    cache_disposition="cache_hit",
                    now=now,
                    original_processing_id=str(record["processing_id"]),
                    attempt_count=1,
                    output=record["output"],
                    output_hash=record.get("output_fingerprint"),
                    usage=record.get("usage"),
                )
                saved, *_ = write_record(
                    root, "processing", processing_id, event, expected_revision=None
                )
                return {"record": saved, "reused_active": False}
        attempt_count = int(retry_of.get("attempt_count", 0)) + 1 if retry_of else 1
        if attempt_count > 3:
            raise ProcessingError(
                "retry_limit", "The bounded processing retry limit has been reached."
            )
        now = _timestamp()
        processing_id = f"processing_{uuid.uuid4().hex}"
        event = self._record(
            workspace_id=workspace_id,
            processing_id=processing_id,
            model=config.model,
            prompt=prompt,
            source_version=source_version,
            input_hash=input_hash,
            key=key,
            status="queued",
            cache_disposition="cache_miss",
            now=now,
            retry_of_processing_id=str(retry_of["processing_id"]) if retry_of else None,
            attempt_count=attempt_count,
        )
        saved, *_ = write_record(root, "processing", processing_id, event, expected_revision=None)
        cancel_event = threading.Event()
        with self.lock:
            self.active[key] = (processing_id, cancel_event)
        self.executor.submit(
            self._run,
            root,
            workspace_id,
            processing_id,
            key,
            source_version,
            system_message,
            user_message,
            cancel_event,
        )
        return {"record": saved, "reused_active": False}

    def _update(
        self,
        root: Path,
        processing_id: str,
        record: dict[str, object],
        expected_revision: str,
    ) -> dict[str, object] | None:
        try:
            saved, *_ = write_record(
                root,
                "processing",
                processing_id,
                record,
                expected_revision=expected_revision,
            )
            return saved
        except WorkspaceConflictError:
            return None

    def _run(
        self,
        root: Path,
        workspace_id: str,
        processing_id: str,
        key: str,
        source_version: str,
        system_message: str,
        user_message: str,
        cancel_event: threading.Event,
    ) -> None:
        try:
            with self.lock:
                record, revision, _ = read_record(root, "processing", processing_id)
                if cancel_event.is_set() or record.get("status") == "cancelled":
                    return
                running = json.loads(json.dumps(record))
                running["status"] = "running"
                running["started_at"] = _timestamp()
                running["updated_at"] = running["started_at"]
                running["error"] = None
                if self._update(root, processing_id, running, revision) is None:
                    return
            request = GenerationRequest(
                operation_id=PROCESSING_OPERATION_ID,
                model=str(record["model"]),
                system_message=system_message,
                user_message=user_message,
                temperature=0.0,
                max_output_tokens=64,
                output_contract="task5b.provider_echo_ack.v1",
                timeout_seconds=15,
            )
            try:
                result = asyncio.run(self.runtime.generation_adapter().generate(request))
                output = _safe_output(source_version, result.structured_output)
                error = None
                status = "completed"
            except ProcessingError as exc:
                output = None
                error = {"category": exc.code, "message": str(exc)}
                status = "failed"
                result = None
            except ProviderGenerationError as exc:
                output = None
                error = {"category": exc.category, "message": exc.message}
                status = "failed"
                result = None
            if cancel_event.is_set():
                status = "cancelled"
                output = None
                error = {
                    "category": "cancelled",
                    "message": "The processing operation was cancelled before completion.",
                }
            finished = json.loads(json.dumps(running))
            finished["status"] = status
            finished["completed_at"] = _timestamp()
            finished["updated_at"] = finished["completed_at"]
            finished["output"] = output
            finished["output_fingerprint"] = output_fingerprint(output) if output else None
            finished["usage"] = (
                {"input_tokens": result.input_tokens, "output_tokens": result.output_tokens}
                if result
                else None
            )
            finished["error"] = error
            finished["provenance"]["recorded_at"] = finished["updated_at"]
            with self.lock:
                current, current_revision, _ = read_record(root, "processing", processing_id)
                if cancel_event.is_set() or current.get("status") == "cancelled":
                    return
                self._update(root, processing_id, finished, current_revision)
        except (OSError, WorkspaceError, ValueError):
            # A durable failure is preferred to an unhandled executor exception.
            try:
                with self.lock:
                    current, revision, _ = read_record(root, "processing", processing_id)
                    if current.get("status") == "cancelled":
                        return
                    failed = json.loads(json.dumps(current))
                    failed["status"] = "failed"
                    failed["completed_at"] = _timestamp()
                    failed["updated_at"] = failed["completed_at"]
                    failed["error"] = {
                        "category": "unexpected_provider_error",
                        "message": "The processing operation failed before a result was saved.",
                    }
                    self._update(root, processing_id, failed, revision)
            except Exception:  # noqa: BLE001 - best-effort durable error reporting.
                return
        finally:
            with self.lock:
                current = self.active.get(key)
                if current and current[0] == processing_id:
                    self.active.pop(key, None)

    def cancel(self, root: Path, processing_id: str) -> dict[str, object]:
        with self.lock:
            record, revision, _ = read_record(root, "processing", processing_id)
            if record.get("status") in {"completed", "failed", "cancelled"}:
                if record.get("status") == "cancelled":
                    return record
                raise ProcessingError(
                    "invalid_state", "Only queued or running processing can be cancelled."
                )
            active = self.active.get(str(record["cache_key"]))
            if active and active[0] == processing_id:
                active[1].set()
            cancelled = json.loads(json.dumps(record))
            cancelled["status"] = "cancelled"
            cancelled["completed_at"] = _timestamp()
            cancelled["updated_at"] = cancelled["completed_at"]
            cancelled["output"] = None
            cancelled["output_fingerprint"] = None
            cancelled["usage"] = None
            cancelled["error"] = {
                "category": "cancelled",
                "message": "The processing operation was cancelled before completion.",
            }
            saved, *_ = write_record(
                root, "processing", processing_id, cancelled, expected_revision=revision
            )
            return saved

    def retry(self, root: Path, workspace_id: str, processing_id: str) -> dict[str, object]:
        record, _, _ = read_record(root, "processing", processing_id)
        if record.get("status") not in {"failed", "cancelled"}:
            raise ProcessingError(
                "invalid_state", "Only failed or cancelled processing can be retried."
            )
        return self.start(
            root,
            workspace_id,
            source_version=str(record["source_snapshot"]["synthetic_input_version"]),
            retry_of=record,
        )

    def invalidate(self, root: Path, processing_id: str) -> dict[str, object]:
        record, revision, _ = read_record(root, "processing", processing_id)
        if record.get("status") != "completed" or record.get("output") is None:
            raise ProcessingError("invalid_state", "Only completed processing can be invalidated.")
        updated = json.loads(json.dumps(record))
        updated["invalidated"] = True
        updated["cache_disposition"] = "invalidated"
        updated["updated_at"] = _timestamp()
        updated["provenance"]["cache_disposition"] = "invalidated"
        saved, *_ = write_record(
            root, "processing", processing_id, updated, expected_revision=revision
        )
        return saved
