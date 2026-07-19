import {
  Activity,
  ArrowUpRight,
  BookOpenCheck,
  CircleDot,
  Compass,
  FolderKanban,
  GitCompare,
  Home,
  LibraryBig,
  MessageCircleQuestion,
  Network,
  Play,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  UsersRound
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Button,
  Card,
  EmptyState,
  FieldControls,
  MatchRing,
  MetricCard,
  Modal,
  PageHeader,
  PaperCard,
  PaperMeta,
  ProposalActions,
  ProgressBar,
  QuestRow,
  SectionHeading,
  StatusPill
} from "./components";
import { accessLabels, paperTypeLabels, papers, projects, settingsCopy } from "./mockData";
import { designTokens } from "./designTokens";
import {
  completePairing,
  DEFAULT_COMPANION_URL,
  PairingStartResponse,
  readCapabilities,
  readHealth,
  startPairing
} from "./companionClient";
import type { DiscoveryView, NavigationItem, PageId, ProposalState, SettingsCategory } from "./types";

const navigationItems: NavigationItem[] = [
  { id: "home", label: "Home", icon: Home },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "discovery", label: "Discovery", icon: Compass },
  { id: "library", label: "Library", icon: LibraryBig },
  { id: "reading", label: "Reading Hub", icon: BookOpenCheck },
  { id: "ask", label: "Ask Library", icon: MessageCircleQuestion },
  { id: "synthesis", label: "Synthesis", icon: GitCompare },
  { id: "gaps", label: "Research Gaps", icon: CircleDot },
  { id: "activity", label: "Activity", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings2 }
];

const pageTitles: Record<PageId, string> = {
  home: "Home",
  projects: "Projects",
  discovery: "Discovery",
  library: "Library",
  reading: "Reading Hub",
  ask: "Ask Library",
  profile: "Research Profile",
  paper: "Focus Reading",
  synthesis: "Synthesis",
  gaps: "Research Gaps",
  activity: "Activity",
  settings: "Settings"
};

type ConnectionState = "checking" | "online" | "offline";
type ModalKind = "onboarding" | "institution" | null;
type AccessFilter = "all" | "pdf_ready" | "institutional" | "repository";
type TypeFilter = "all" | "empirical" | "experiment" | "conceptual" | "review";
type ReadingTime = "5" | "15" | "30" | "deep";

function pageFromHash(): PageId {
  const value = window.location.hash.slice(1) as PageId;
  return value in pageTitles ? value : "home";
}

function AppShell({ children, page, onNavigate, connectionState, connectionMessage, onOpenOnboarding }: { children: ReactNode; page: PageId; onNavigate: (id: PageId) => void; connectionState: ConnectionState; connectionMessage: string; onOpenOnboarding: () => void }) {
  const activeNavigation = page === "profile" ? "projects" : page === "paper" ? "reading" : page;
  return (
    <div className="app-shell" data-design-token-version={designTokens.meta.version}>
      <aside className="sidebar">
        <div className="sidebar-top">
          <button className="brand-mark" aria-label="Go to Home" onClick={() => onNavigate("home")}>
            <ShieldCheck size={22} aria-hidden="true" />
            <span>RI</span>
          </button>
          <nav className="nav-list" aria-label="Primary navigation">
            {navigationItems.map(({ id, label, icon: Icon }) => (
              <a
                className={`nav-item ${activeNavigation === id ? "nav-item-active" : ""}`}
                href={`#${id}`}
                aria-current={activeNavigation === id ? "page" : undefined}
                key={id}
                onClick={(event) => { event.preventDefault(); onNavigate(id); }}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </a>
            ))}
          </nav>
        </div>
        <div className="sidebar-footer">
          <span className="sidebar-footer-label">Pre-alpha</span>
          <span className="sidebar-footer-dot" aria-hidden="true" />
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="topbar-title">Research Workspace <span>/ {pageTitles[page]}</span></div>
          <label className="search-field">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search papers, projects and notes</span>
            <input aria-label="Search papers, projects and notes" placeholder="Search papers, projects and notes" />
          </label>
          <button className="connection-status" onClick={onOpenOnboarding} aria-label="Open companion connection setup">
            <span className={`connection-dot connection-${connectionState}`} aria-hidden="true" />
            <span data-testid="companion-connection-status" role="status" aria-live="polite" data-connection-state={connectionState === "online" ? "connected" : connectionState === "offline" ? "disconnected" : "checking"}>
              <strong>{connectionState === "online" ? "Connected" : connectionState === "checking" ? "Checking" : "Disconnected"}</strong>
              <small>{connectionMessage}</small>
            </span>
          </button>
          <Button variant="secondary" onClick={onOpenOnboarding} icon={<Sparkles size={16} />}>Onboarding</Button>
          <div className="avatar" aria-label="Emmy Wong">EW</div>
        </header>
        {children}
      </main>
    </div>
  );
}

export function App() {
  const [page, setPage] = useState<PageId>(pageFromHash);
  const [connectionState, setConnectionState] = useState<ConnectionState>("checking");
  const [connectionMessage, setConnectionMessage] = useState("Checking local companion");
  const [capabilities, setCapabilities] = useState<string[]>([]);
  const [companionUrl, setCompanionUrl] = useState(DEFAULT_COMPANION_URL);
  const [pairing, setPairing] = useState<PairingStartResponse | null>(null);
  const [pairingCode, setPairingCode] = useState("");
  const [sessionEstablished, setSessionEstablished] = useState(false);
  const [pairingError, setPairingError] = useState("");
  const [modal, setModal] = useState<ModalKind>(null);
  const [discoveryView, setDiscoveryView] = useState<DiscoveryView>("table");
  const [selectedPaperId, setSelectedPaperId] = useState(papers[0].id);
  const [matchFloor, setMatchFloor] = useState("70");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [accessFilter, setAccessFilter] = useState<AccessFilter>("all");
  const [readingTime, setReadingTime] = useState<ReadingTime>("15");
  const [settingsCategory, setSettingsCategory] = useState<SettingsCategory>("workspace");
  const [proposalState, setProposalState] = useState<ProposalState>("pending");

  useEffect(() => {
    const syncHash = () => setPage(pageFromHash());
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  useEffect(() => {
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setModal(null);
    };
    window.addEventListener("keydown", closeWithEscape);
    return () => window.removeEventListener("keydown", closeWithEscape);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkCompanion() {
      setConnectionState("checking");
      try {
        const [health, capabilityResponse] = await Promise.all([readHealth(companionUrl), readCapabilities(companionUrl)]);
        if (cancelled) return;
        setConnectionState(health.loopback_only ? "online" : "offline");
        setCapabilities(capabilityResponse.capabilities);
        setConnectionMessage(health.loopback_only ? `Loopback companion ${health.companion_version}` : "Companion is not loopback-only");
      } catch {
        if (!cancelled) {
          setConnectionState("offline");
          setCapabilities([]);
          setConnectionMessage("Local companion unavailable");
        }
      }
    }
    void checkCompanion();
    return () => { cancelled = true; };
  }, [companionUrl]);

  const filteredPapers = useMemo(() => papers.filter((paper) => paper.match >= Number(matchFloor) && (typeFilter === "all" || paper.type === typeFilter) && (accessFilter === "all" || paper.access === accessFilter)), [accessFilter, matchFloor, typeFilter]);
  const selectedPaper = papers.find((paper) => paper.id === selectedPaperId) ?? papers[0];

  useEffect(() => {
    if (filteredPapers.length > 0 && !filteredPapers.some((paper) => paper.id === selectedPaperId)) {
      setSelectedPaperId(filteredPapers[0].id);
    }
  }, [filteredPapers, selectedPaperId]);

  function navigate(nextPage: PageId) {
    window.history.replaceState(null, "", `#${nextPage}`);
    setPage(nextPage);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  async function handleStartPairing() {
    setPairingError("");
    try {
      const started = await startPairing(companionUrl);
      setPairing(started);
      setPairingCode("");
      setSessionEstablished(false);
    } catch {
      setPairingError("Pairing could not start. Check that the local companion is running.");
    }
  }

  async function handleCompletePairing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!pairing) return;
    setPairingError("");
    try {
      await completePairing(companionUrl, pairing.pairing_id, pairingCode);
      setSessionEstablished(true);
      setPairingError("");
    } catch {
      setPairingError("The approval code was not accepted. Check the companion console and try again.");
    }
  }

  function reviewPaper(paperId: string = selectedPaperId) {
    setSelectedPaperId(paperId);
    navigate("paper");
  }

  function moveSelectedPaper(direction: -1 | 1) {
    const index = papers.findIndex((paper) => paper.id === selectedPaperId);
    const nextIndex = (index + direction + papers.length) % papers.length;
    setSelectedPaperId(papers[nextIndex].id);
  }

  return (
    <AppShell page={page} onNavigate={navigate} connectionState={connectionState} connectionMessage={connectionMessage} onOpenOnboarding={() => setModal("onboarding")}>
      {page === "home" ? <HomePage onNavigate={navigate} onReview={() => reviewPaper()} /> : null}
      {page === "projects" ? <ProjectsPage onNavigate={navigate} onReview={reviewPaper} /> : null}
      {page === "discovery" ? <DiscoveryPage view={discoveryView} onViewChange={setDiscoveryView} papers={filteredPapers} selectedPaperId={selectedPaperId} onSelect={setSelectedPaperId} onReview={reviewPaper} onPrevious={() => moveSelectedPaper(-1)} onNext={() => moveSelectedPaper(1)} matchFloor={matchFloor} onMatchFloorChange={setMatchFloor} typeFilter={typeFilter} onTypeFilterChange={setTypeFilter} accessFilter={accessFilter} onAccessFilterChange={setAccessFilter} /> : null}
      {page === "library" ? <LibraryPage onReview={reviewPaper} /> : null}
      {page === "reading" ? <ReadingPage readingTime={readingTime} onReadingTimeChange={setReadingTime} onReview={() => reviewPaper()} onOpenInstitution={() => setModal("institution")} /> : null}
      {page === "ask" ? <AskLibraryPage /> : null}
      {page === "profile" ? <ResearchProfilePage proposalState={proposalState} onProposalStateChange={setProposalState} /> : null}
      {page === "paper" ? <PaperPage paper={selectedPaper} onNavigate={navigate} onPrevious={() => moveSelectedPaper(-1)} onNext={() => moveSelectedPaper(1)} /> : null}
      {page === "synthesis" ? <SynthesisPage /> : null}
      {page === "gaps" ? <GapsPage onReview={() => reviewPaper("p2")} /> : null}
      {page === "activity" ? <ActivityPage /> : null}
      {page === "settings" ? <SettingsPage category={settingsCategory} onCategoryChange={setSettingsCategory} /> : null}
      <Modal open={modal === "onboarding"} eyebrow="Onboarding" title="Set up your local-first workspace" onClose={() => setModal(null)}>
        <p className="modal-description">Your papers, notes and research records stay in a folder you control. API keys and the per-installation companion secret remain in the operating-system keychain.</p>
        <div className="modal-step-grid">
          <Card className="step-card"><strong>1. Choose workspace</strong><p>Select a local or Dropbox folder.</p></Card>
          <Card className="step-card"><strong>2. Pair companion</strong><p>Confirm the code shown by the local companion.</p></Card>
          <Card className="step-card"><strong>3. Add AI provider</strong><p>Store your key securely in the OS keychain.</p></Card>
          <Card className="step-card"><strong>4. Create project</strong><p>Describe your research idea naturally.</p></Card>
        </div>
        <Card className="pairing-panel">
          <SectionHeading title="Local companion" action={<StatusPill tone={connectionState === "online" ? "accent" : "warning"}>{connectionState === "online" ? "Available" : "Check connection"}</StatusPill>} />
          <p className="muted-copy">The browser never receives the companion approval code or keychain secret. Enter the code displayed independently by the companion console.</p>
          <label htmlFor="companion-url">Companion URL</label>
          <input id="companion-url" value={companionUrl} onChange={(event) => setCompanionUrl(event.target.value)} spellCheck={false} />
          <Button variant="primary" onClick={() => void handleStartPairing()} icon={<Network size={16} />}>Start pairing</Button>
          {pairing ? (
            <form className="pairing-complete" onSubmit={handleCompletePairing}>
              <div className="pairing-request" data-testid="pairing-request-status"><span className="label">Pairing request</span><strong data-testid="pairing-id">{pairing.pairing_id}</strong><span className="muted-copy">Expires {pairing.expires_at}</span></div>
              <label htmlFor="pairing-code">Approval code shown by companion</label>
              <input id="pairing-code" value={pairingCode} onChange={(event) => setPairingCode(event.target.value)} placeholder="Enter companion code" autoComplete="off" spellCheck={false} />
              <Button variant="secondary" type="submit" disabled={!pairingCode.trim()} icon={<ShieldCheck size={16} />}>Complete pairing</Button>
            </form>
          ) : null}
          {sessionEstablished ? <p className="success-message" data-testid="pairing-session-status" role="status" aria-live="polite">Paired session established in memory. No token was written to browser storage.</p> : null}
          {pairingError ? <p className="error-message" role="alert">{pairingError}</p> : null}
          <div className="capability-summary"><span className="label">Capabilities</span><span data-testid="companion-capabilities">{capabilities.length ? capabilities.join(" · ") : "Unavailable until connected"}</span></div>
        </Card>
      </Modal>
      <Modal open={modal === "institution"} eyebrow="Institutional access" title="Open through University of Warwick" onClose={() => setModal(null)}>
        <p className="modal-description">Research Intelligence never stores institutional credentials or bypasses paywalls. Sign in normally through your browser, download the paper, then attach it to your workspace.</p>
        <div className="callout">Credentials, MFA codes, session cookies and publisher tokens are never stored.</div>
        <div className="modal-actions"><Button variant="secondary" onClick={() => setModal(null)}>Cancel</Button><Button variant="primary" onClick={() => setModal(null)} icon={<ArrowUpRight size={16} />}>Open browser route</Button></div>
      </Modal>
    </AppShell>
  );
}

function HomePage({ onNavigate, onReview }: { onNavigate: (page: PageId) => void; onReview: () => void }) {
  return <div className="page"><PageHeader eyebrow="Good evening, Emmy" title="Continue your research momentum" description="Your project landscape, reading target, discovery inbox and gap status in one focused view." action={<Button variant="primary" onClick={() => onNavigate("reading")} icon={<Play size={16} />}>Start reading</Button>} /><div className="grid grid-4"><MetricCard label="Reading streak" value="6 days" note="1 of 2 papers today" /><MetricCard label="New papers" value="12" note="since last search" /><MetricCard label="Ready to read" value="8" note="PDF available" /><MetricCard label="Gap signal" value="Narrowing" note="3 new studies" /></div><div className="split-layout home-layout"><Card className="home-landscape"><div className="card-heading"><div><p className="eyebrow">Current project</p><h2>AI versus Human Advice</h2></div><StatusPill>Active</StatusPill></div><ResearchLandscapeVector /><div className="paper-stats"><div><span className="label">Coverage</span><strong>76%</strong></div><div><span className="label">Reviewed</span><strong>34</strong></div><div><span className="label">Conflicts</span><strong>4</strong></div></div></Card><div className="stack"><Card><p className="eyebrow">Today's target</p><p className="metric-value">1 / 2 papers</p><ProgressBar value={50} /></Card><Card><p className="eyebrow">Recommended next</p><h3>Conversational Memory and Advice Reliance</h3><p className="muted-copy">Standard read · 18 minutes</p><Button variant="primary" onClick={onReview} className="full-button">Continue paper</Button></Card></div></div></div>;
}

function ResearchLandscapeVector() {
  const { accent, text, muted } = { accent: designTokens.color.accent, text: designTokens.color.text, muted: designTokens.color.muted };
  return <div className="landscape-vector"><svg viewBox="0 0 720 290" role="img" aria-label="Research landscape showing question, interaction dynamics, decision type and gap"><path d="M95 145 C205 42 320 45 430 145 S585 230 650 145" fill="none" stroke="#34413b" strokeWidth="2" /><path d="M95 145 C210 228 325 220 430 145 S575 55 650 145" fill="none" stroke="#34413b" strokeWidth="2" /><circle cx="95" cy="145" r="43" fill="#17201c" stroke={accent} strokeWidth="2" /><text x="95" y="140" textAnchor="middle" fill={text} fontSize="13">Research</text><text x="95" y="158" textAnchor="middle" fill={muted} fontSize="11">question</text><circle cx="280" cy="78" r="34" fill="#17201c" stroke="#52615b" /><text x="280" y="75" textAnchor="middle" fill={text} fontSize="11">Interaction</text><text x="280" y="91" textAnchor="middle" fill={muted} fontSize="10">dynamics</text><circle cx="280" cy="214" r="34" fill="#17201c" stroke="#52615b" /><text x="280" y="211" textAnchor="middle" fill={text} fontSize="11">Decision</text><text x="280" y="227" textAnchor="middle" fill={muted} fontSize="10">type</text><rect x="405" y="95" width="108" height="100" rx="16" fill="#1a2420" stroke="#415149" /><circle cx="650" cy="145" r="45" fill="#16211d" stroke={accent} strokeWidth="2" /><text x="650" y="140" textAnchor="middle" fill={accent} fontSize="12">Gap</text><text x="650" y="158" textAnchor="middle" fill={text} fontSize="11">plausible</text></svg></div>;
}

function ProjectsPage({ onNavigate, onReview }: { onNavigate: (page: PageId) => void; onReview: (paperId: string) => void }) {
  return <div className="page"><PageHeader eyebrow="Projects" title="Your research projects" action={<Button variant="primary" icon={<Plus size={16} />}>New project</Button>} /><div className="grid grid-3">{projects.map((project) => <Card as="article" className="project-card" key={project.id}><StatusPill tone={project.status === "active" ? "accent" : "muted"}>{project.status === "active" ? "Active" : "Paused"}</StatusPill><h2>{project.name}</h2><p className="muted-copy">{project.description}</p><div className="paper-stats"><div><span className="label">Papers</span><strong>{project.papers}</strong></div><div><span className="label">New</span><strong>{project.newPapers}</strong></div><div><span className="label">Gap</span><strong>{project.gap}</strong></div></div><Button variant={project.id === "ai-advice" ? "primary" : "secondary"} onClick={() => project.id === "ai-advice" ? onNavigate("profile") : onReview("p1")} className="full-button">Open project</Button></Card>)}</div></div>;
}

function DiscoveryPage({ view, onViewChange, papers: filteredPapers, selectedPaperId, onSelect, onReview, onPrevious, onNext, matchFloor, onMatchFloorChange, typeFilter, onTypeFilterChange, accessFilter, onAccessFilterChange }: { view: DiscoveryView; onViewChange: (view: DiscoveryView) => void; papers: typeof papers; selectedPaperId: string; onSelect: (id: string) => void; onReview: (id: string) => void; onPrevious: () => void; onNext: () => void; matchFloor: string; onMatchFloorChange: (value: string) => void; typeFilter: TypeFilter; onTypeFilterChange: (value: TypeFilter) => void; accessFilter: AccessFilter; onAccessFilterChange: (value: AccessFilter) => void }) {
  const selectedPaper = filteredPapers.find((paper) => paper.id === selectedPaperId) ?? filteredPapers[0];
  return <div className="page"><PageHeader eyebrow="Discovery Inbox" title={`${filteredPapers.length} papers matched your project`} description="Review the same evidence through table, card or immersive Paper Field views." action={<Button variant="primary" icon={<Search size={16} />}>Run literature search</Button>} /><Card className="discovery-toolbar"><div className="filter-row"><label>Project<select aria-label="Project filter" defaultValue="ai-advice"><option value="ai-advice">AI versus Human Advice</option></select></label><label>Match<select aria-label="Match filter" value={matchFloor} onChange={(event) => onMatchFloorChange(event.target.value)}><option value="70">Match ≥ 70%</option><option value="80">Match ≥ 80%</option><option value="90">Match ≥ 90%</option></select></label><label>Type<select aria-label="Paper type filter" value={typeFilter} onChange={(event) => onTypeFilterChange(event.target.value as TypeFilter)}><option value="all">All paper types</option><option value="empirical">Empirical</option><option value="experiment">Experiment</option><option value="conceptual">Conceptual</option><option value="review">Review</option></select></label><label>Access<select aria-label="Access filter" value={accessFilter} onChange={(event) => onAccessFilterChange(event.target.value as AccessFilter)}><option value="all">All access states</option><option value="pdf_ready">PDF ready</option><option value="institutional">Institutional</option><option value="repository">Repository</option></select></label></div><div className="view-switcher" role="group" aria-label="Discovery view"><Button data-testid="discovery-table-view" variant={view === "table" ? "primary" : "secondary"} aria-pressed={view === "table"} onClick={() => onViewChange("table")}>Table</Button><Button data-testid="discovery-cards-view" variant={view === "cards" ? "primary" : "secondary"} aria-pressed={view === "cards"} onClick={() => onViewChange("cards")}>Cards</Button><Button data-testid="discovery-field-view" variant={view === "field" ? "primary" : "secondary"} aria-pressed={view === "field"} onClick={() => onViewChange("field")}>Paper Field</Button></div></Card>{view === "table" ? <DiscoveryTable papers={filteredPapers} selectedPaperId={selectedPaperId} onSelect={onSelect} onReview={onReview} /> : null}{view === "cards" ? <div className="grid grid-3 discovery-grid">{filteredPapers.map((paper) => <PaperCard paper={paper} key={paper.id} selected={paper.id === selectedPaperId} onSelect={() => onSelect(paper.id)} onReview={() => onReview(paper.id)} />)}</div> : null}{view === "field" ? <PaperField papers={filteredPapers} selectedPaper={selectedPaper} onSelect={onSelect} onReview={onReview} onPrevious={onPrevious} onNext={onNext} /> : null}{filteredPapers.length === 0 ? <EmptyState title="No papers match these filters" description="Adjust the screening filters to return to the shared discovery set." /> : null}</div>;
}

function DiscoveryTable({ papers: records, selectedPaperId, onSelect, onReview }: { papers: typeof papers; selectedPaperId: string; onSelect: (id: string) => void; onReview: (id: string) => void }) {
  return <Card className="table-card"><div className="table-scroll"><table className="data-table"><caption className="sr-only">Discovery papers and relevance</caption><thead><tr><th>Paper and relevance</th><th>Type</th><th>Match</th><th>Access</th><th>Reading</th><th>Action</th></tr></thead><tbody>{records.map((paper) => <tr className={paper.id === selectedPaperId ? "selected-row" : ""} key={paper.id}><td><button className="paper-title-button" onClick={() => onSelect(paper.id)} aria-pressed={paper.id === selectedPaperId}>{paper.title}</button><div className="label">{paper.year} · {paper.projectName}</div><div className="table-reason">{paper.reason}</div></td><td><StatusPill>{paperTypeLabels[paper.type]}</StatusPill></td><td><MatchRing value={paper.match} /></td><td>{accessLabels[paper.access]}</td><td>{paper.readingMinutes} min</td><td><Button variant="primary" onClick={() => onReview(paper.id)}>Review</Button></td></tr>)}</tbody></table></div></Card>;
}

function PaperField({ papers: records, selectedPaper, onSelect, onReview, onPrevious, onNext }: { papers: typeof papers; selectedPaper: (typeof papers)[number] | undefined; onSelect: (id: string) => void; onReview: (id: string) => void; onPrevious: () => void; onNext: () => void }) {
  return <Card className="paper-field-card"><div className="card-heading"><div><p className="eyebrow">Paper Field</p><h2>Immersive spatial selection</h2></div><FieldControls onPrevious={onPrevious} onNext={onNext} /></div><div className="paper-field-stage">{records.map((paper, index) => { const selectedIndex = records.findIndex((record) => record.id === selectedPaper?.id); const distance = index - selectedIndex; return <button className={`field-paper ${paper.id === selectedPaper?.id ? "field-paper-selected" : ""}`} key={paper.id} style={{ transform: `translate(-50%, -50%) translateX(${distance * 42}px) rotate(${distance * 9}deg) translateZ(${240 - Math.abs(distance) * 30}px)`, zIndex: 70 - Math.abs(distance), opacity: Math.max(0.16, 1 - Math.abs(distance) * 0.13) }} onClick={() => onSelect(paper.id)} aria-label={`Select ${paper.title}`} aria-pressed={paper.id === selectedPaper?.id}><PaperMeta paper={paper} /><h3>{paper.title}</h3><p>{paper.match}% match · {accessLabels[paper.access]} · {paper.readingMinutes} min</p><p>{paper.reason}</p></button>; })}</div>{selectedPaper ? <div className="field-detail"><div><strong>{selectedPaper.title}</strong><p>{selectedPaper.reason}</p><span className="accent-text">{selectedPaper.match}% · {accessLabels[selectedPaper.access]} · {selectedPaper.readingMinutes} min</span></div><Button variant="primary" onClick={() => onReview(selectedPaper.id)}>Review paper</Button></div> : <EmptyState title="No selected paper" description="Choose a paper after adjusting your filters." />}</Card>;
}

function LibraryPage({ onReview }: { onReview: (paperId: string) => void }) {
  return <div className="page"><PageHeader eyebrow="Library" title="146 saved papers" action={<Button variant="primary" icon={<Plus size={16} />}>Import PDF</Button>} /><Card className="filter-summary"><div className="chip-row"><StatusPill tone="muted">All projects</StatusPill><StatusPill tone="muted">Ready to read</StatusPill><StatusPill tone="muted">Empirical</StatusPill><StatusPill tone="muted">High priority</StatusPill></div></Card><Card className="table-card"><div className="table-scroll"><table className="data-table library-table"><caption className="sr-only">Saved library papers</caption><thead><tr><th>Paper</th><th>Year</th><th>Type</th><th>Projects</th><th>Reading status</th><th>Summary</th></tr></thead><tbody>{papers.slice(0, 3).map((paper, index) => <tr key={paper.id}><td><button className="paper-title-button" onClick={() => onReview(paper.id)}>{paper.title}</button></td><td>{paper.year}</td><td>{paperTypeLabels[paper.type]}</td><td>AI Advice</td><td>{index === 0 ? "Standard 3/7" : index === 1 ? "Standard 4/7" : "Quick reviewed"}</td><td><StatusPill>{index === 2 ? "Verified" : "Full text"}</StatusPill></td></tr>)}</tbody></table></div></Card></div>;
}

function ReadingPage({ readingTime, onReadingTimeChange, onReview, onOpenInstitution }: { readingTime: ReadingTime; onReadingTimeChange: (time: ReadingTime) => void; onReview: () => void; onOpenInstitution: () => void }) {
  const sessionLabel = readingTime === "deep" ? "Deep reading session" : readingTime === "5" ? "Quick review · 5 minutes" : readingTime === "15" ? "Standard read · 15 minutes" : "Focused read · 30 minutes";
  return <div className="page"><PageHeader eyebrow="Reading Hub" title="Choose a session that fits your time" action={<StatusPill>6-day streak · 1/2 today</StatusPill>} /><div className="focus-layout reading-layout"><div className="stack"><Card><p className="eyebrow">Available time</p><div className="time-options">{(["5", "15", "30", "deep"] as ReadingTime[]).map((time) => <Button key={time} variant={readingTime === time ? "primary" : "secondary"} aria-pressed={readingTime === time} onClick={() => onReadingTimeChange(time)}>{time === "deep" ? "Deep" : `${time} min`}</Button>)}</div></Card><Card><p className="eyebrow">Daily target</p><p className="metric-value">1 / 2 papers</p><ProgressBar value={50} /></Card></div><Card><div className="card-heading"><div><p className="eyebrow">Recommended session</p><h2 data-testid="reading-session-label">{sessionLabel}</h2></div><StatusPill>PDF ready</StatusPill></div><Card as="article" className="recommended-paper"><PaperMeta paper={papers[0]} /><h3>{papers[0].title}</h3><p>{papers[0].reason}</p><div className="paper-stats"><div><span className="label">Match</span><strong>94%</strong></div><div><span className="label">Progress</span><strong>3/7</strong></div><div><span className="label">Difficulty</span><strong>Medium</strong></div></div><Button variant="primary" onClick={onReview} className="full-button">Start reading</Button></Card></Card><div className="stack"><Card><p className="eyebrow">Continue reading</p><h3>Static Labels versus Real Interaction</h3><p className="muted-copy">4 of 7 steps</p><Button variant="secondary" onClick={onReview} className="full-button">Continue</Button></Card><Card><p className="eyebrow">Access required</p><h3>Why People Delegate Personal Decisions to AI</h3><Button variant="secondary" onClick={onOpenInstitution} className="full-button" icon={<UsersRound size={16} />}>Open through Warwick</Button></Card></div></div></div>;
}

function AskLibraryPage() {
  return <div className="page"><PageHeader eyebrow="Ask Library" title="Ask across your verified research library" description="Answers preserve source scope, paper type and provenance." /><div className="split-layout"><Card><p className="eyebrow">Question</p><textarea rows={5} placeholder="How does real interaction change willingness to follow AI advice?" /><div className="chip-row"><StatusPill>Project: AI Advice</StatusPill><StatusPill>Verified sources only</StatusPill><StatusPill>Private notes excluded</StatusPill></div><Button variant="primary" className="full-button">Ask library</Button></Card><Card><p className="eyebrow">Evidence boundary</p><p className="muted-copy">18 full-text papers, 4 abstract-only papers.</p><div className="callout">Outbound preview enabled before external AI processing.</div></Card></div></div>;
}

function ResearchProfilePage({ proposalState, onProposalStateChange }: { proposalState: ProposalState; onProposalStateChange: (state: ProposalState) => void }) {
  return <div className="page"><PageHeader eyebrow="Research Profile" title="AI versus Human Advice" action={<Button variant="primary" icon={<Sparkles size={16} />}>Update from idea</Button>} /><div className="split-layout"><Card><ProfileRow label="Core question">Is advisor preference shaped only by AI versus human framing, or by the dynamics of real interaction?</ProfileRow><ProfileRow label="Core concepts"><Chip>Advisor preference</Chip><Chip>Advice taking</Chip><Chip>Interaction dynamics</Chip><Chip>Contextual awareness</Chip></ProfileRow><ProfileRow label="Theories"><Chip>Advice-taking theory</Chip><Chip>Trust calibration</Chip><Chip>Cognitive burden</Chip></ProfileRow><ProfileRow label="Preferred evidence"><Chip>Experiments</Chip><Chip>Interactive studies</Chip><Chip>Behavioural outcomes</Chip></ProfileRow></Card><div className="stack"><Card><p className="eyebrow">Profile strength</p><p className="metric-value">82%</p><ProgressBar value={82} /></Card><Card className="proposal-card"><StatusPill tone={proposalState === "pending" ? "accent" : proposalState === "rejected" ? "danger" : "muted"}>{proposalState === "pending" ? "Suggested learning" : `Proposal ${proposalState}`}</StatusPill><h3>Prioritise real interaction</h3><p>Eight relevant papers involved conversational interaction. Five static-label studies were marked peripheral.</p><ProposalActions state={proposalState} onChange={onProposalStateChange} /></Card></div></div></div>;
}

function ProfileRow({ label, children }: { label: string; children: ReactNode }) { return <div className="profile-row"><span className="label">{label}</span><div>{children}</div></div>; }
function Chip({ children }: { children: ReactNode }) { return <span className="chip">{children}</span>; }

function PaperPage({ paper, onNavigate, onPrevious, onNext }: { paper: (typeof papers)[number]; onNavigate: (page: PageId) => void; onPrevious: () => void; onNext: () => void }) {
  return <div className="page"><PageHeader eyebrow="Focus reading" title={paper.title} description="Standard reading quest · 3 of 7 steps" action={<Button variant="secondary" onClick={() => onNavigate("reading")}>Exit focus</Button>} /><div className="paper-navigation"><Button variant="secondary" onClick={onPrevious}>Previous paper</Button><span className="muted-copy">{paper.id.toUpperCase()} · {paper.year}</span><Button variant="secondary" onClick={onNext}>Next paper</Button></div><div className="focus-layout paper-focus-layout"><Card><p className="eyebrow">Reading quest</p><QuestRow done number={1} label="30-second summary" /><QuestRow done number={2} label="Research question" /><QuestRow done number={3} label="Theory" /><QuestRow number={4} label="Method" /><QuestRow number={5} label="Findings" /><QuestRow number={6} label="Limitations" /><QuestRow number={7} label="Add note" /></Card><Card><div className="card-heading"><StatusPill>Method section</StatusPill><span className="label">Page 7 of 18</span></div><h2 className="focus-heading">Study design and sample</h2><p className="focus-copy">The paper reports two preregistered online experiments. Participants received advice from an advisor labelled either human or AI, while the advisor's ability to remember prior information was manipulated independently.</p><div className="callout">Project relevance: this directly separates source identity from experienced interaction quality.</div><div className="inline-actions"><Button variant="primary">Complete step</Button><Button variant="secondary">Open PDF page</Button></div></Card><div className="stack"><Card><p className="eyebrow">AI reading companion</p><div className="stack compact-stack"><Button variant="secondary">Explain simply</Button><Button variant="secondary">Relate to my project</Button><Button variant="secondary">Challenge this method</Button><Button variant="secondary">Turn into a note</Button></div></Card><Card><p className="eyebrow">Notes</p><textarea rows={7} placeholder="Record your interpretation…" /></Card></div></div></div>;
}

function SynthesisPage() {
  return <div className="page"><PageHeader eyebrow="Synthesis" title="Compare evidence without mixing incompatible paper types" action={<Button variant="primary" icon={<Plus size={16} />}>New synthesis</Button>} /><div className="synthesis-layout"><Card className="step-menu"><Button variant="primary">1. Choose purpose</Button><Button variant="secondary">2. Select papers</Button><Button variant="secondary">3. Separate types</Button><Button variant="secondary">4. Choose schema</Button><Button variant="secondary">5. Review evidence</Button><Button variant="secondary">6. Interpret</Button></Card><Card><p className="eyebrow">Current synthesis</p><h2>Interaction dynamics and advice use</h2><div className="grid grid-3 synthesis-metrics"><Card as="article"><StatusPill>Empirical</StatusPill><p className="metric-value">14</p><span className="label">papers</span></Card><Card as="article"><StatusPill>Conceptual</StatusPill><p className="metric-value">2</p><span className="label">papers</span></Card><Card as="article"><StatusPill>Reviews</StatusPill><p className="metric-value">2</p><span className="label">papers</span></Card></div><div className="callout">Across empirical studies, interaction quality appears to explain more variance in advice use than source label once participants experience the advisor directly.</div></Card></div></div>;
}

function GapsPage({ onReview }: { onReview: () => void }) {
  return <div className="page"><PageHeader eyebrow="Research Gap Tracker" title="Track whether your contribution still holds" action={<Button variant="primary" icon={<Plus size={16} />}>New gap claim</Button>} /><div className="split-layout"><div className="stack"><Card><div className="card-heading"><div><p className="eyebrow">Current gap claim</p><h2>Existing studies compare AI and human labels, but rarely isolate matched real interaction dynamics.</h2></div><StatusPill>Plausible</StatusPill></div><div className="paper-stats"><div><span className="label">Support</span><strong>11</strong></div><div><span className="label">Challenges</span><strong>3</strong></div><div><span className="label">Assessed</span><strong>Today</strong></div></div></Card><Card><p className="eyebrow">Latest update</p><div className="grid grid-2 gap-update"><Card as="article"><span className="label">New evidence</span><p>Three recent papers examine conversational AI. One includes a human comparison, but interactions are not structurally matched.</p></Card><Card as="article"><span className="label">Assessment</span><p>The gap narrows from interaction generally to structurally matched human–AI interaction.</p></Card></div><div className="callout">Recommended revision: focus on matched, real-time human and AI advising.</div></Card></div><div className="stack"><Card><p className="eyebrow">Status</p><p className="metric-value accent-text">Plausible</p></Card><Card><p className="eyebrow">Strongest challenge</p><h3>One field study includes repeated human and AI advice.</h3></Card><Button variant="primary" onClick={onReview}>Review challenge paper</Button></div></div></div>;
}

function ActivityPage() {
  return <div className="page"><PageHeader eyebrow="Activity Centre" title="See what the platform searched, processed and saved" action={<Button variant="primary" icon={<Play size={16} />}>Run due tasks</Button>} /><div className="grid grid-4"><MetricCard label="Queue" value="7" /><MetricCard label="Completed today" value="18" /><MetricCard label="Attention" value="2" /><MetricCard label="AI use" value="£0.84" /></div><Card className="activity-card"><div className="card-heading"><div><p className="eyebrow">Current processing</p><h2>Automatic literature update</h2></div><StatusPill>Running</StatusPill></div><ProgressBar value={64} /><div className="stack activity-events"><Card as="article"><strong>OpenAlex and Crossref search completed</strong><p>186 records retrieved; 43 remained after filtering.</p></Card><Card as="article"><strong>AI relevance screening</strong><p>Analysing 12 candidates.</p></Card><Card as="article"><strong>Institutional PDF required</strong><p className="warning-text">Why People Delegate Personal Decisions to AI</p></Card></div></Card></div>;
}

function SettingsPage({ category, onCategoryChange }: { category: SettingsCategory; onCategoryChange: (category: SettingsCategory) => void }) {
  return <div className="page"><PageHeader eyebrow="Settings" title="Workspace, AI, automation and privacy" action={<Button variant="primary">Save changes</Button>} /><div className="settings-layout"><Card className="settings-menu">{(Object.keys(settingsCopy) as SettingsCategory[]).map((key) => <Button key={key} variant={category === key ? "primary" : "secondary"} aria-pressed={category === key} onClick={() => onCategoryChange(key)}>{settingsCopy[key].label}</Button>)}</Card><Card className="settings-panel"><p className="eyebrow">{settingsCopy[category].label}</p><div className="settings-rows">{settingsCopy[category].rows.map(([label, value]) => <ProfileRow label={label} key={label}>{value === "Healthy" ? <StatusPill>Healthy</StatusPill> : value}</ProfileRow>)}</div>{category === "privacy" ? <div className="callout">Paper content sent to an external AI provider always requires an outbound preview. Private notes are excluded by default.</div> : null}{category === "institution" ? <div className="callout">Institutional credentials, MFA codes and publisher session cookies are never stored.</div> : null}</Card></div></div>;
}
