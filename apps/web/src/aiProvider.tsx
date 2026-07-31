import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CompanionRequestError,
  CompanionUnavailableError,
  readProviderStatus,
  removeProviderCredential,
  saveProviderCredential,
  testProviderConnection,
  writeProviderConfig,
  type ProviderConfig,
  type ProviderState,
  type ProviderStatusResponse
} from "./companionClient";
import { Button, StatusPill } from "./components";

type ConnectionState = "checking" | "online" | "offline";
type SaveState = "idle" | "saving" | "saved" | "error";
type Draft = Pick<ProviderConfig, "provider" | "model" | "timeout_seconds" | "max_retries" | "enabled">;

type AiProviderSettingsProps = {
  companionUrl: string;
  sessionToken: string;
  connectionState: ConnectionState;
};

const DEFAULT_DRAFT: Draft = {
  provider: "openai",
  model: "gpt-4o-mini",
  timeout_seconds: 15,
  max_retries: 1,
  enabled: true
};

const stateLabels: Record<ProviderState, string> = {
  unconfigured: "No AI provider configured",
  configured_without_credential: "Provider configured, credential missing",
  ready_untested: "Ready to test",
  connection_verified: "Connection verified",
  connection_failed: "Connection test failed",
  credential_removed: "Credential removed",
  configuration_invalid: "Provider configuration unavailable"
};

function errorMessage(error: unknown): string {
  if (error instanceof CompanionUnavailableError) return "The local companion is unavailable.";
  if (error instanceof CompanionRequestError) {
    if (error.status === 401) return "The companion session expired. Pair this browser again.";
    if (error.status === 409) return "The provider configuration changed elsewhere. Reload it before saving.";
    if (error.status === 503) return "The operating-system keychain is unavailable. No plaintext fallback is used.";
    return error.message;
  }
  return error instanceof Error ? error.message : "The provider operation could not be completed.";
}

function draftFromStatus(status: ProviderStatusResponse): Draft {
  return status.config ? {
    provider: status.config.provider,
    model: status.config.model,
    timeout_seconds: status.config.timeout_seconds,
    max_retries: status.config.max_retries,
    enabled: status.config.enabled
  } : { ...DEFAULT_DRAFT };
}

export function AiProviderSettings({ companionUrl, sessionToken, connectionState }: AiProviderSettingsProps) {
  const [status, setStatus] = useState<ProviderStatusResponse | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...DEFAULT_DRAFT });
  const [credentialInput, setCredentialInput] = useState("");
  const [showCredentialInput, setShowCredentialInput] = useState(false);
  const [configState, setConfigState] = useState<SaveState>("idle");
  const [credentialState, setCredentialState] = useState<SaveState>("idle");
  const [testState, setTestState] = useState<SaveState>("idle");
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");

  const connected = Boolean(sessionToken && connectionState === "online");
  const configRevision = status?.config?.revision;
  const hasCredential = status?.credential_state === "present";
  const canTest = Boolean(status?.config && hasCredential && status?.state !== "configuration_invalid");
  const stateTone = useMemo(() => {
    if (!status) return "muted" as const;
    if (status.state === "connection_verified") return "accent" as const;
    if (status.state === "connection_failed" || status.state === "configuration_invalid") return "danger" as const;
    if (status.state === "configured_without_credential" || status.state === "credential_removed") return "warning" as const;
    return "muted" as const;
  }, [status]);

  const loadStatus = useCallback(async () => {
    if (!connected) return;
    setLoadError("");
    try {
      const next = await readProviderStatus(companionUrl, sessionToken);
      setStatus(next);
      setDraft(draftFromStatus(next));
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }, [companionUrl, connected, sessionToken]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  async function saveConfig() {
    if (!connected) return;
    setConfigState("saving");
    setMessage("");
    try {
      const next = await writeProviderConfig(companionUrl, sessionToken, draft, configRevision);
      setStatus(next);
      setDraft(draftFromStatus(next));
      setConfigState("saved");
      setMessage("Provider configuration saved. Test the connection explicitly.");
    } catch (error) {
      setConfigState("error");
      setMessage(errorMessage(error));
    }
  }

  async function storeCredential() {
    if (!connected || !credentialInput.trim()) return;
    setCredentialState("saving");
    setMessage("");
    try {
      const result = await saveProviderCredential(companionUrl, sessionToken, credentialInput);
      setCredentialInput("");
      setShowCredentialInput(false);
      setCredentialState("saved");
      setStatus((current) => current ? { ...current, credential_state: result.credential_state, state: result.state, last_test: null } : current);
      setMessage("Credential stored in the operating-system keychain. Test the connection explicitly.");
    } catch (error) {
      setCredentialState("error");
      setMessage(errorMessage(error));
    }
  }

  async function removeCredential() {
    if (!connected) return;
    setCredentialState("saving");
    try {
      const result = await removeProviderCredential(companionUrl, sessionToken);
      setCredentialInput("");
      setShowCredentialInput(false);
      setCredentialState("saved");
      setStatus((current) => current ? { ...current, credential_state: result.credential_state, state: result.state, last_test: null } : current);
      setMessage("Credential removed from the operating-system keychain.");
    } catch (error) {
      setCredentialState("error");
      setMessage(errorMessage(error));
    }
  }

  async function runConnectionTest() {
    if (!connected || !canTest) return;
    setTestState("saving");
    setMessage("");
    try {
      const result = await testProviderConnection(companionUrl, sessionToken, configRevision);
      setTestState(result.result.status === "success" ? "saved" : "error");
      setStatus((current) => current ? { ...current, last_test: result.result, state: result.result.status === "success" ? "connection_verified" : "connection_failed" } : current);
      setMessage(result.result.message);
    } catch (error) {
      setTestState("error");
      setMessage(errorMessage(error));
    }
  }

  if (!connected) {
    return <div data-testid="ai-provider-settings"><p className="muted-copy">Pair the browser with the local companion before configuring an AI provider.</p></div>;
  }
  if (loadError) {
    return <div data-testid="ai-provider-settings"><p className="error-message" role="alert">{loadError}</p><Button onClick={() => void loadStatus()}>Retry</Button></div>;
  }
  if (!status) {
    return <div data-testid="ai-provider-settings"><p className="muted-copy" role="status" aria-live="polite">Loading provider settings…</p></div>;
  }

  return <div className="ai-provider-settings" data-testid="ai-provider-settings">
    <div className="card-heading">
      <div><p className="eyebrow">AI Provider</p><h2>Local provider connection</h2></div>
      <span data-testid="ai-provider-state"><StatusPill tone={stateTone}>{stateLabels[status.state]}</StatusPill></span>
    </div>
    <p className="muted-copy">Provider configuration stays on this device. Credentials are stored only in the operating-system keychain and are never returned to the browser.</p>
    <div className="settings-rows">
      <label className="provider-field"><span className="label">Provider</span><select value={draft.provider} disabled={Boolean(status.config)} onChange={(event) => setDraft({ ...draft, provider: event.target.value as "openai" })}><option value="openai">OpenAI-compatible</option></select></label>
      <label className="provider-field"><span className="label">Model</span><input aria-label="Provider model" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} /></label>
      <label className="provider-field"><span className="label">Timeout (seconds)</span><input aria-label="Provider timeout" type="number" min={1} max={30} value={draft.timeout_seconds} onChange={(event) => setDraft({ ...draft, timeout_seconds: Number(event.target.value) })} /></label>
      <label className="provider-field"><span className="label">Transient retries</span><select aria-label="Provider retries" value={draft.max_retries} onChange={(event) => setDraft({ ...draft, max_retries: Number(event.target.value) as 0 | 1 })}><option value={0}>None</option><option value={1}>At most one</option></select></label>
    </div>
    <div className="inline-actions">
      <Button variant="primary" onClick={() => void saveConfig()} disabled={configState === "saving"}>{status.config ? "Save configuration" : "Configure provider"}</Button>
      <Button variant="secondary" onClick={() => setShowCredentialInput((current) => !current)}>{hasCredential ? "Replace credential" : "Add credential"}</Button>
      {hasCredential ? <Button variant="ghost" onClick={() => void removeCredential()} disabled={credentialState === "saving"}>Remove credential</Button> : null}
    </div>
    {showCredentialInput ? <div className="provider-credential-form">
      <label htmlFor="ai-provider-credential">Provider credential</label>
      <input id="ai-provider-credential" data-testid="ai-provider-credential-input" type="password" value={credentialInput} onChange={(event) => setCredentialInput(event.target.value)} autoComplete="new-password" />
      <p className="muted-copy">The input is cleared after storage. The credential is not written to workspace files, browser storage, logs or API responses.</p>
      <Button variant="secondary" onClick={() => void storeCredential()} disabled={!credentialInput.trim() || credentialState === "saving"}>Store in OS keychain</Button>
    </div> : null}
    <section className="provider-status-card" data-testid="ai-provider-connection-status">
      <div className="card-heading"><div><p className="eyebrow">Credential status</p><h3>{status.credential_state === "present" ? "Secure credential present" : status.credential_state === "unavailable" ? "Keychain unavailable" : "No credential stored"}</h3></div><StatusPill tone={status.credential_state === "present" ? "accent" : "warning"}>{status.credential_state === "present" ? "Secure" : status.credential_state === "unavailable" ? "Blocked" : "Not configured"}</StatusPill></div>
      <p className="muted-copy">{status.credential_state === "unavailable" ? "The keychain is unavailable. No plaintext fallback is used, and provider testing is blocked." : "No connection test runs on load. Use the explicit test action after configuration and credential storage."}</p>
      <Button variant="primary" onClick={() => void runConnectionTest()} disabled={!canTest || testState === "saving"}>Test provider connection</Button>
      {status.last_test ? <p className={status.last_test.status === "success" ? "success-message" : "error-message"} data-testid="ai-provider-test-result" role="status" aria-live="polite">{status.last_test.message}</p> : null}
    </section>
    {message ? <p className={testState === "error" || credentialState === "error" || configState === "error" ? "error-message" : "success-message"} role="status" aria-live="polite">{message}</p> : null}
  </div>;
}
