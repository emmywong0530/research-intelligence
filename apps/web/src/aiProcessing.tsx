import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CompanionRequestError,
  CompanionUnavailableError,
  listProcessingOperations,
  listProcessingPrompts,
  listProcessingRecords,
  processingAction,
  readProcessingRecord,
  setProcessingScenario,
  startProcessing,
  type ProcessingOperation,
  type ProcessingPrompt,
  type ProcessingRecord
} from "./companionClient";
import { Button, Card, SectionHeading, StatusPill } from "./components";

type ConnectionState = "checking" | "online" | "offline";
type Props = { companionUrl: string; sessionToken: string; workspaceId: string | null; connectionState: ConnectionState };

const PROCESSING_POLL_INTERVAL_MS = 250;
const PROCESSING_POLL_MAX_MS = 30_000;
const PROCESSING_POLL_MAX_CONSECUTIVE_ERRORS = 3;

function errorMessage(error: unknown): string {
  if (error instanceof CompanionUnavailableError) return "The local companion is unavailable.";
  if (error instanceof CompanionRequestError) {
    if (error.status === 401) return "The companion session expired. Pair this browser again.";
    if (error.status === 404) return "Synthetic processing is available only in the explicit test companion mode.";
    return error.message;
  }
  return error instanceof Error ? error.message : "The processing operation could not be completed.";
}

function statusTone(record: ProcessingRecord | null) {
  if (!record) return "muted" as const;
  if (record.status === "completed") return "accent" as const;
  if (record.status === "failed" || record.status === "cancelled") return "danger" as const;
  return "warning" as const;
}

function sourceLabel(record: ProcessingRecord): string {
  return record.source_snapshot.source_type === "synthetic"
    ? record.source_snapshot.synthetic_input_version
    : "paper extraction";
}

function outputLabel(record: ProcessingRecord): string {
  if (!record.output) return "";
  return record.output.contract_id === "task5b.provider_echo_ack.v1"
    ? record.output.acknowledgement
    : "Paper summary completed.";
}

export function AiProcessingPanel({ companionUrl, sessionToken, workspaceId, connectionState }: Props) {
  const [operation, setOperation] = useState<ProcessingOperation | null>(null);
  const [prompt, setPrompt] = useState<ProcessingPrompt | null>(null);
  const [record, setRecord] = useState<ProcessingRecord | null>(null);
  const [history, setHistory] = useState<ProcessingRecord[]>([]);
  const [sourceVersion, setSourceVersion] = useState("v1");
  const [scenario, setScenario] = useState<"success" | "invalid_output" | "delayed" | "timeout" | "provider_unavailable">("success");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [unavailable, setUnavailable] = useState("");
  const pollVersion = useRef(0);
  const [pollRestart, setPollRestart] = useState(0);

  const connected = Boolean(connectionState === "online" && sessionToken && workspaceId);
  const currentId = record?.processing_id;
  const active = record?.status === "queued" || record?.status === "running";

  const load = useCallback(async () => {
    if (!connected || !workspaceId) return;
    setLoading(true);
    setUnavailable("");
    try {
      const [operations, prompts, records] = await Promise.all([
        listProcessingOperations(companionUrl, sessionToken, workspaceId),
        listProcessingPrompts(companionUrl, sessionToken, workspaceId),
        listProcessingRecords(companionUrl, sessionToken, workspaceId)
      ]);
      setOperation(operations.operations[0] ?? null);
      setPrompt(prompts.prompts[0] ?? null);
      const nextHistory = records.records.map((item) => item.record).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      setHistory(nextHistory);
      setRecord((current) => current ? nextHistory.find((item) => item.processing_id === current.processing_id) ?? nextHistory[0] ?? null : nextHistory[0] ?? null);
    } catch (error) {
      setUnavailable(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [companionUrl, connected, sessionToken, workspaceId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!active || !currentId || !workspaceId) return;

    let cancelled = false;
    let timer: number | undefined;
    let consecutiveErrors = 0;
    const startedAt = Date.now();
    const version = pollVersion.current;

    const replaceHistoryRecord = (nextRecord: ProcessingRecord) => {
      setHistory((current) => {
        const found = current.some((item) => item.processing_id === nextRecord.processing_id);
        return found
          ? current.map((item) => item.processing_id === nextRecord.processing_id ? nextRecord : item)
          : [nextRecord, ...current];
      });
    };

    const stopPolling = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
    };

    const poll = async (): Promise<void> => {
      if (cancelled || version !== pollVersion.current) return;
      try {
        const response = await readProcessingRecord(companionUrl, sessionToken, workspaceId, currentId);
        if (cancelled || version !== pollVersion.current || response.record.processing_id !== currentId) return;
        consecutiveErrors = 0;
        setRecord(response.record);
        replaceHistoryRecord(response.record);
        if (response.record.status === "queued" || response.record.status === "running") {
          if (Date.now() - startedAt >= PROCESSING_POLL_MAX_MS) {
            setMessage("Processing is taking longer than the local status window. Refresh to check again.");
            stopPolling();
            return;
          }
          timer = window.setTimeout(() => void poll(), PROCESSING_POLL_INTERVAL_MS);
        } else {
          stopPolling();
        }
      } catch (error) {
        if (cancelled || version !== pollVersion.current) return;
        const sessionExpired = error instanceof CompanionRequestError && error.status === 401;
        const companionUnavailable = error instanceof CompanionUnavailableError;
        if (sessionExpired || companionUnavailable) {
          setMessage(errorMessage(error));
          stopPolling();
          return;
        }
        consecutiveErrors += 1;
        if (consecutiveErrors >= PROCESSING_POLL_MAX_CONSECUTIVE_ERRORS || Date.now() - startedAt >= PROCESSING_POLL_MAX_MS) {
          setMessage(`Unable to refresh processing status. ${errorMessage(error)}`);
          stopPolling();
          return;
        }
        timer = window.setTimeout(() => void poll(), PROCESSING_POLL_INTERVAL_MS);
      }
    };

    timer = window.setTimeout(() => void poll(), PROCESSING_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      pollVersion.current += 1;
      stopPolling();
    };
  }, [active, companionUrl, currentId, pollRestart, sessionToken, workspaceId]);

  const canStart = Boolean(operation && prompt && !active && !loading);
  const historyLabel = useMemo(() => `${history.length} recorded test ${history.length === 1 ? "event" : "events"}`, [history.length]);

  async function run() {
    if (!workspaceId || !canStart) return;
    setMessage("");
    try {
      const response = await startProcessing(companionUrl, sessionToken, workspaceId, sourceVersion.trim());
      setRecord(response.record);
      setHistory((current) => [response.record, ...current.filter((item) => item.processing_id !== response.record.processing_id)]);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function updateScenario() {
    try {
      await setProcessingScenario(companionUrl, sessionToken, scenario);
      setMessage(`Synthetic scenario set to ${scenario}.`);
    } catch (error) {
      setMessage(errorMessage(error));
    }
  }

  async function action(kind: "cancel" | "retry" | "invalidate") {
    if (!workspaceId || !record) return;
    setMessage("");
    if (kind === "cancel") pollVersion.current += 1;
    try {
      const response = await processingAction(companionUrl, sessionToken, workspaceId, record.processing_id, kind);
      setRecord(response.record);
      setHistory((current) => [response.record, ...current.filter((item) => item.processing_id !== response.record.processing_id)]);
    } catch (error) {
      setMessage(errorMessage(error));
      if (kind === "cancel") setPollRestart((value) => value + 1);
    }
  }

  if (!connected) return <section data-testid="ai-processing-panel"><p className="muted-copy">Connect a paired workspace to inspect the local processing framework.</p></section>;
  if (unavailable) return <section data-testid="ai-processing-panel"><p className="muted-copy">{unavailable}</p></section>;
  if (loading && !operation) return <section data-testid="ai-processing-panel"><p className="muted-copy" role="status">Loading processing framework…</p></section>;

  return <section className="ai-processing-panel" data-testid="ai-processing-panel">
    <SectionHeading title="Processing framework test" action={<StatusPill tone={operation ? "accent" : "muted"}>{operation ? "Test-only" : "Unavailable"}</StatusPill>} />
    <p className="muted-copy">Fixed synthetic acknowledgement only. This does not process papers, notes or research content, and does not claim output quality.</p>
    {operation && prompt ? <>
      <div className="settings-rows">
        <div><span className="label">Operation</span><strong>{operation.title}</strong></div>
        <div><span className="label">Prompt</span><span>{prompt.prompt_id} · v{prompt.version}</span></div>
        <div><span className="label">Output contract</span><span>{prompt.output_contract}</span></div>
      </div>
      <div className="processing-controls">
        <label><span className="label">Synthetic input version</span><input aria-label="Synthetic input version" value={sourceVersion} onChange={(event) => setSourceVersion(event.target.value)} /></label>
        <Button variant="primary" onClick={() => void run()} disabled={!canStart}>Run synthetic processing test</Button>
      </div>
      <div className="processing-controls">
        <label><span className="label">Test-only provider scenario</span><select aria-label="Test-only provider scenario" value={scenario} onChange={(event) => setScenario(event.target.value as typeof scenario)}><option value="success">Success</option><option value="invalid_output">Invalid output</option><option value="delayed">Delayed</option><option value="timeout">Timeout</option><option value="provider_unavailable">Unavailable</option></select></label>
        <Button variant="secondary" onClick={() => void updateScenario()}>Set test scenario</Button>
      </div>
      {record ? <Card className="processing-result" data-testid="ai-processing-result">
        <div className="card-heading"><div><p className="eyebrow">Latest processing event</p><h3>{record.status === "completed" ? "Synthetic result" : "Processing status"}</h3></div><StatusPill tone={statusTone(record)}>{record.status}</StatusPill></div>
        <p className="muted-copy">Cache: {record.cache_disposition}. Source version: {sourceLabel(record)}. {record.stale ? "Stale source snapshot. " : ""}{record.invalidated ? "Cache invalidated." : ""}</p>
        {record.output ? <p data-testid="ai-processing-output"><strong>{outputLabel(record)}</strong> Output contract {record.output.contract_id}.</p> : null}
        {record.error ? <p className="error-message" role="alert">{record.error.message}</p> : null}
        <div className="inline-actions">{active ? <Button variant="secondary" onClick={() => void action("cancel")}>Cancel processing</Button> : null}{record.status === "failed" || record.status === "cancelled" ? <Button variant="secondary" onClick={() => void action("retry")}>Retry explicitly</Button> : null}{record.status === "completed" && !record.invalidated ? <Button variant="ghost" onClick={() => void action("invalidate")}>Invalidate cache</Button> : null}</div>
      </Card> : null}
      <div className="processing-history" aria-label="Processing history"><div className="card-heading"><h3>History</h3><span className="label">{historyLabel}</span></div>{history.slice(0, 5).map((item) => <div className="processing-history-row" key={item.processing_id}><span>{sourceLabel(item)}</span><StatusPill tone={statusTone(item)}>{item.status}</StatusPill><span className="muted-copy">{item.cache_disposition}</span></div>)}</div>
    </> : null}
    {message ? <p className="muted-copy" role="status">{message}</p> : null}
  </section>;
}
