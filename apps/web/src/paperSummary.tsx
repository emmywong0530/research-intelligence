import { AlertTriangle, RefreshCw, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  CompanionRequestError,
  listPaperSummaryRecords,
  paperSummaryAction,
  readPaperSummaryPreflight,
  readPaperSummaryRecord,
  startPaperSummary,
  type PaperRecord,
  type PaperSummaryPreflightResponse,
  type ProcessingRecord
} from "./companionClient";
import { Button, Modal, SectionHeading, StatusPill } from "./components";

type ConnectionState = "checking" | "online" | "offline";
type WorkspaceState = "idle" | "working" | "connected" | "error";
type PaperSummaryOutput = Extract<NonNullable<ProcessingRecord["output"]>, { contract_id: "paper-summary.v1" }>;

function isPaperSummaryOutput(output: ProcessingRecord["output"]): output is PaperSummaryOutput {
  if (!output || output.contract_id !== "paper-summary.v1" || !("summary" in output)) return false;
  return typeof output.summary === "string" &&
    Array.isArray(output.key_points) &&
    output.key_points.every((item) => typeof item === "string") &&
    Array.isArray(output.limitations) &&
    output.limitations.every((item) => typeof item === "string") &&
    Array.isArray(output.open_questions) &&
    output.open_questions.every((item) => typeof item === "string");
}

export type PaperSummarySectionProps = {
  paper: PaperRecord;
  companionUrl: string;
  sessionToken: string;
  workspaceId: string | null;
  projectId: string;
  paperRevision?: string;
  workspaceState: WorkspaceState;
  connectionState: ConnectionState;
};

function messageFor(error: unknown): string {
  if (error instanceof CompanionRequestError) {
    if (error.status === 401) return "The companion session expired. Pair this browser again.";
    if (error.status === 403) return "This paper summary is not available for the active project.";
    if (error.status === 404) return "The paper or its local extraction is no longer available.";
    if (error.status === 409) return "The paper or extraction changed. Reload the paper before trying again.";
    return error.message;
  }
  return error instanceof Error ? error.message : "The paper summary could not be loaded.";
}

function statusTone(record: ProcessingRecord): "accent" | "muted" | "warning" | "danger" {
  if (record.invalidated || record.stale) return "warning";
  if (record.status === "completed") return "accent";
  if (record.status === "failed") return "danger";
  if (record.status === "cancelled") return "warning";
  return "muted";
}

function statusLabel(record: ProcessingRecord): string {
  if (record.invalidated) return "Invalidated";
  if (record.stale) return "Stale source";
  return record.status;
}

export function PaperSummarySection({
  paper,
  companionUrl,
  sessionToken,
  workspaceId,
  projectId,
  paperRevision,
  workspaceState,
  connectionState
}: PaperSummarySectionProps) {
  const [preflight, setPreflight] = useState<PaperSummaryPreflightResponse | null>(null);
  const [history, setHistory] = useState<Array<{ record_id: string; record: ProcessingRecord; revision: string }>>([]);
  const [active, setActive] = useState<ProcessingRecord | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState("");
  const generation = useRef(0);
  const activeRecordRef = useRef<ProcessingRecord | null>(null);

  function isCurrentRecord(record: ProcessingRecord | null): record is ProcessingRecord {
    return Boolean(
      record &&
      record.workspace_id === workspaceId &&
      record.project_id === projectId &&
      record.paper_id === paper.paper_id
    );
  }

  function setActiveRecord(record: ProcessingRecord | null) {
    activeRecordRef.current = record;
    setActive(record);
  }

  async function load() {
    if (!workspaceId || !sessionToken) return;
    const current = generation.current + 1;
    generation.current = current;
    setState("loading");
    setError("");
    try {
      const [nextPreflight, nextHistory] = await Promise.all([
        readPaperSummaryPreflight(companionUrl, sessionToken, workspaceId, projectId, paper.paper_id),
        listPaperSummaryRecords(companionUrl, sessionToken, workspaceId, projectId, paper.paper_id)
      ]);
      if (current !== generation.current) return;
      if (nextPreflight.workspace_id !== workspaceId || nextPreflight.project_id !== projectId || nextPreflight.paper_id !== paper.paper_id || nextHistory.workspace_id !== workspaceId) {
        throw new Error("The companion returned summary data from another workspace or paper.");
      }
      const scoped = nextHistory.records.filter(({ record }) => isCurrentRecord(record) && record.operation_id === "paper_summary");
      const ordered = [...scoped].sort((left, right) => right.record.updated_at.localeCompare(left.record.updated_at) || right.record.processing_id.localeCompare(left.record.processing_id));
      const previouslyActive = activeRecordRef.current;
      const latest = ordered[0]?.record ?? null;
      const matchingActive = previouslyActive ? ordered.find(({ record }) => record.processing_id === previouslyActive.processing_id)?.record ?? null : null;
      const nextActive = matchingActive
        ? latest && matchingActive.updated_at < latest.updated_at ? latest : matchingActive
        : latest && previouslyActive && isCurrentRecord(previouslyActive) && previouslyActive.updated_at >= latest.updated_at
          ? previouslyActive
          : latest ?? (isCurrentRecord(previouslyActive) ? previouslyActive : null);
      setPreflight(nextPreflight);
      setHistory(ordered);
      setActiveRecord(nextActive);
      setState("ready");
    } catch (loadError) {
      if (current !== generation.current) return;
      setState("error");
      setError(messageFor(loadError));
    }
  }

  useEffect(() => {
    if (connectionState !== "online" || workspaceState !== "connected" || !workspaceId) return;
    void load();
    return () => { generation.current += 1; };
  }, [companionUrl, connectionState, paper.paper_id, paper.updated_at, projectId, sessionToken, workspaceId, workspaceState]);

  function updateHistory(next: ProcessingRecord) {
    if (!isCurrentRecord(next)) {
      setError("The companion returned summary data from another workspace or paper.");
      return;
    }
    setActiveRecord(next);
    setHistory((current) => {
      const item = { record_id: next.processing_id, record: next, revision: "" };
      return current.some((entry) => entry.record_id === next.processing_id)
        ? current.map((entry) => entry.record_id === next.processing_id ? { ...entry, record: next } : entry)
        : [item, ...current];
    });
  }

  function poll(processingId: string) {
    const pollGeneration = generation.current;
    const step = async () => {
      if (pollGeneration !== generation.current || !workspaceId) return;
      try {
        const response = await readPaperSummaryRecord(companionUrl, sessionToken, workspaceId, projectId, paper.paper_id, processingId);
        if (pollGeneration !== generation.current) return;
        updateHistory(response.record);
        if (response.record.status === "queued" || response.record.status === "running") {
          window.setTimeout(() => void step(), 250);
        } else {
          void load();
        }
      } catch (pollError) {
        if (pollGeneration !== generation.current) return;
        setError(messageFor(pollError));
        setState("error");
      }
    };
    void step();
  }

  async function confirmSummary() {
    if (!workspaceId) return;
    setConfirmOpen(false);
    setError("");
    try {
      const response = await startPaperSummary(companionUrl, sessionToken, workspaceId, projectId, paper.paper_id, paperRevision);
      updateHistory(response.record);
      poll(response.record.processing_id);
    } catch (startError) {
      setError(messageFor(startError));
      setState("error");
    }
  }

  async function action(kind: "cancel" | "retry" | "invalidate") {
    if (!workspaceId || !active) return;
    setError("");
    try {
      const response = await paperSummaryAction(companionUrl, sessionToken, workspaceId, projectId, paper.paper_id, active.processing_id, kind);
      updateHistory(response.record);
      if (kind === "retry") poll(response.record.processing_id);
      else void load();
    } catch (actionError) {
      setError(messageFor(actionError));
    }
  }

  const output: PaperSummaryOutput | null = isCurrentRecord(active) && active.status === "completed" && !active.invalidated && isPaperSummaryOutput(active.output)
    ? active.output
    : null;
  const busy = active?.status === "queued" || active?.status === "running";

  if (connectionState !== "online" || workspaceState !== "connected" || !workspaceId) {
    return <section className="paper-summary-section" data-testid="paper-summary-section"><SectionHeading title="Paper summary" /><p className="muted-copy">Pair the companion and open a healthy workspace to request an explicit summary.</p></section>;
  }

  return <>
    <section className="paper-summary-section" data-testid="paper-summary-section" aria-labelledby="paper-summary-heading">
      <div className="section-heading"><div><p className="eyebrow">Explicit AI action</p><h3 id="paper-summary-heading">Paper summary</h3></div><StatusPill tone={output ? (active?.stale ? "warning" : "accent") : "muted"}>{output ? (active?.stale ? "Stale source" : "Available") : "Not applied"}</StatusPill></div>
      <p className="muted-copy">Prepared for your review from this paper's local extracted text. It is never generated automatically.</p>
      {state === "loading" ? <p className="workspace-status" role="status">Checking summary source…</p> : null}
      {state === "error" ? <p className="error-message" role="alert">{error}</p> : null}
      {preflight && !preflight.eligible ? <div className="callout" data-testid="paper-summary-ineligible"><strong>Summary unavailable</strong><p>{preflight.message}</p></div> : null}
      {preflight?.eligible ? <div className="paper-summary-source" data-testid="paper-summary-source"><span>Source: local extracted text</span><span>{preflight.included_page_count} of {preflight.page_count} pages · {preflight.included_characters} characters{preflight.truncated ? " · bounded" : ""}</span><span>Metadata: {preflight.metadata_fields.join(", ")}</span></div> : null}
      {output ? <div className="paper-summary-output" data-testid="paper-summary-output"><p>{output.summary}</p><h4>Key points</h4><ul>{output.key_points.map((point) => <li key={point}>{point}</li>)}</ul>{output.limitations.length ? <><h4>Limitations</h4><ul>{output.limitations.map((item) => <li key={item}>{item}</li>)}</ul></> : null}{output.open_questions.length ? <><h4>Open questions</h4><ul>{output.open_questions.map((item) => <li key={item}>{item}</li>)}</ul></> : null}</div> : null}
      {active && !output ? <p className="summary-status" role="status" data-testid="paper-summary-processing-status">Latest request: <StatusPill tone={statusTone(active)}>{statusLabel(active)}</StatusPill>{active.error ? ` ${active.error.message}` : ""}</p> : null}
      <div className="inline-actions">
        {preflight?.eligible && !busy ? <Button variant="primary" onClick={() => setConfirmOpen(true)} icon={<Sparkles size={15} />}>{preflight.cache_available ? "Use cached summary" : "Generate summary"}</Button> : null}
        {busy ? <Button variant="secondary" onClick={() => void action("cancel")} icon={<AlertTriangle size={15} />}>Cancel summary</Button> : null}
        {active?.status === "failed" || active?.status === "cancelled" ? <Button variant="secondary" onClick={() => void action("retry")} icon={<RefreshCw size={15} />}>Retry summary</Button> : null}
        {active?.status === "completed" && !active.invalidated ? <Button variant="ghost" onClick={() => void action("invalidate")}>Invalidate summary</Button> : null}
        <Button variant="ghost" onClick={() => void load()}>Refresh</Button>
      </div>
      {history.length ? <div className="paper-summary-history" data-testid="paper-summary-history" aria-label="Paper summary history"><div className="card-heading"><h4>Summary history</h4><span className="label">{history.length} event{history.length === 1 ? "" : "s"}</span></div>{history.slice(0, 5).map(({ record }) => <div className="paper-summary-history-row" key={record.processing_id} data-testid={`paper-summary-history-event-${record.processing_id}`} data-processing-id={record.processing_id} data-status={record.status} data-cache-disposition={record.cache_disposition}><span>{new Date(record.requested_at).toLocaleString()}</span><StatusPill tone={statusTone(record)}>{statusLabel(record)}</StatusPill><span className="muted-copy">{record.cache_disposition}</span></div>)}</div> : null}
      {error && state !== "error" ? <p className="error-message" role="alert">{error}</p> : null}
    </section>
    <Modal open={confirmOpen} eyebrow="Requires your approval" title="Generate a paper summary?" onClose={() => setConfirmOpen(false)}>
      <p className="modal-description">The companion will send a bounded source made from {preflight?.included_page_count ?? 0} extracted pages and the listed paper metadata to the configured provider. Notes, research profiles, credentials and file paths are excluded.</p>
      <div className="callout"><strong>Source: local extracted text</strong><p>{preflight?.included_characters ?? 0} characters{preflight?.truncated ? " (bounded to the local processing limit)" : ""}. Model: {preflight?.model ?? "configured provider"}.</p></div>
      <div className="modal-actions"><Button variant="secondary" onClick={() => setConfirmOpen(false)}>Cancel</Button><Button variant="primary" onClick={() => void confirmSummary()} icon={<Sparkles size={15} />}>Confirm and generate</Button></div>
    </Modal>
  </>;
}
