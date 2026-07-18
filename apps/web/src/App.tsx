import { CheckCircle2, KeyRound, PlugZap, ShieldCheck } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  completePairing,
  DEFAULT_COMPANION_URL,
  PairingStartResponse,
  readCapabilities,
  readHealth,
  startPairing
} from "./companionClient";

const navItems = [
  "Home",
  "Projects",
  "Discovery",
  "Library",
  "Reading Hub",
  "Ask Library",
  "Synthesis",
  "Research Gaps",
  "Activity",
  "Settings"
];

type ConnectionState = "checking" | "online" | "offline";

export function App() {
  const [companionUrl, setCompanionUrl] = useState(DEFAULT_COMPANION_URL);
  const [connectionState, setConnectionState] = useState<ConnectionState>("checking");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [pairing, setPairing] = useState<PairingStartResponse | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [sessionToken, setSessionToken] = useState<string | null>(null);
  const [message, setMessage] = useState("Checking local companion");

  useEffect(() => {
    let cancelled = false;

    async function checkCompanion() {
      setConnectionState("checking");
      try {
        const [health, capabilityResponse] = await Promise.all([
          readHealth(companionUrl),
          readCapabilities(companionUrl)
        ]);
        if (cancelled) {
          return;
        }
        setConnectionState(health.loopback_only ? "online" : "offline");
        setCapabilities(capabilityResponse.capabilities);
        setMessage(
          health.loopback_only
            ? `Loopback companion online (${health.companion_version})`
            : "Companion is not loopback-only"
        );
      } catch {
        if (!cancelled) {
          setConnectionState("offline");
          setCapabilities([]);
          setMessage("Local companion unavailable");
        }
      }
    }

    void checkCompanion();
    return () => {
      cancelled = true;
    };
  }, [companionUrl]);

  const connectionLabel = useMemo(() => {
    if (connectionState === "online") {
      return "Connected";
    }
    if (connectionState === "checking") {
      return "Checking";
    }
    return "Disconnected";
  }, [connectionState]);

  async function handleStartPairing() {
    const started = await startPairing(companionUrl);
    setPairing(started);
    setPairingCode(started.pairing_code);
    setSessionToken(null);
    setMessage("Pairing code issued by loopback companion");
  }

  async function handleCompletePairing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pairing) {
      return;
    }
    const completed = await completePairing(companionUrl, pairing.pairing_id, pairingCode);
    setSessionToken(completed.session_token);
    setMessage("Paired session established in memory");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <ShieldCheck aria-hidden="true" />
          <span>Research Intelligence</span>
        </div>
        <nav className="nav-list" aria-label="Primary navigation">
          {navItems.map((item) => (
            <a key={item} href={`#${item.toLowerCase().replaceAll(" ", "-")}`}>
              {item}
            </a>
          ))}
        </nav>
      </aside>

      <main className="workspace">
        <section className="status-band" aria-label="Companion connection status">
          <div className={`status-dot ${connectionState}`} aria-hidden="true" />
          <div>
            <p className="eyebrow">Task 0 companion status</p>
            <h1>{connectionLabel}</h1>
            <p>{message}</p>
          </div>
        </section>

        <section className="panel-grid" aria-label="Task 0 pairing screen">
          <div className="panel">
            <div className="panel-title">
              <PlugZap aria-hidden="true" />
              <h2>Loopback Companion</h2>
            </div>
            <label htmlFor="companion-url">Companion URL</label>
            <input
              id="companion-url"
              value={companionUrl}
              onChange={(event) => setCompanionUrl(event.target.value)}
              spellCheck={false}
            />
            <button className="primary" type="button" onClick={handleStartPairing}>
              <KeyRound aria-hidden="true" />
              Start Pairing
            </button>
          </div>

          <form className="panel" onSubmit={handleCompletePairing}>
            <div className="panel-title">
              <CheckCircle2 aria-hidden="true" />
              <h2>Pairing Screen</h2>
            </div>
            <label htmlFor="pairing-code">Pairing code</label>
            <input
              id="pairing-code"
              value={pairingCode}
              onChange={(event) => setPairingCode(event.target.value)}
              spellCheck={false}
            />
            <button className="secondary" type="submit" disabled={!pairing}>
              Complete Pairing
            </button>
            <p className="muted">
              {sessionToken
                ? "Session token is held only in component state for this spike."
                : "No paired session yet."}
            </p>
          </form>

          <div className="panel">
            <h2>Task 0 Capabilities</h2>
            <ul className="capability-list">
              {capabilities.map((capability) => (
                <li key={capability}>{capability}</li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
