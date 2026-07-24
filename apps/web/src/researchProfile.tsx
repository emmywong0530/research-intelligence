import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, Edit3, Plus, RefreshCw, Save, X } from "lucide-react";
import {
  CompanionRequestError,
  CompanionUnavailableError,
  listResearchProfiles,
  readResearchProfile,
  researchProfileIdForProject,
  writeResearchProfile,
  type ProjectRecord,
  type ResearchProfileProposal,
  type ResearchProfileProposalValue,
  type ResearchProfileRecord
} from "./companionClient";
import { Button, Card, EmptyState, Modal, PageHeader, SectionHeading, StatusPill } from "./components";
import type { PageId } from "./types";
import {
  PROPOSAL_TARGET_LABELS,
  buildDecisionRecord,
  buildReversalRecord,
  isActionableProposal,
  profileValue,
  proposalTarget,
  proposalTitle,
  validateProposalForApplication
} from "./profileLearning";
import type { ProposalAction } from "./profileLearning";

type ConnectionState = "checking" | "online" | "offline";
type WorkspaceState = "idle" | "working" | "connected" | "error";
type ProfileLoadState = "idle" | "loading" | "empty" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";
type EditorMode = "create" | "edit";
type ConceptDraft = { term: string; weightInput: string };

const PROFILE_LIST_FIELDS = [
  "synonyms",
  "theories",
  "mechanisms",
  "outcomes",
  "contexts",
  "populations",
  "preferred_disciplines",
  "preferred_evidence_types",
  "exclusions",
  "watched_authors",
  "search_queries"
] as const;

type ProfileListField = (typeof PROFILE_LIST_FIELDS)[number];

const PROFILE_LIST_LABELS: Record<ProfileListField, string> = {
  synonyms: "Synonyms",
  theories: "Theories",
  mechanisms: "Mechanisms",
  outcomes: "Outcomes",
  contexts: "Contexts",
  populations: "Populations",
  preferred_disciplines: "Preferred disciplines",
  preferred_evidence_types: "Preferred evidence types",
  exclusions: "Exclusions",
  watched_authors: "Watched authors",
  search_queries: "Search queries"
};

type ProfileDraft = {
  central_research_question: string;
  concepts: ConceptDraft[];
} & Record<ProfileListField, string[]>;
type ProfileDraftField = "central_research_question" | ProfileListField | "concepts";
type ProfileDraftFieldValue = string | string[] | ConceptDraft[];

type ConflictState = {
  localDraft: ProfileDraft;
  latestDraft: ProfileDraft | null;
  latestRevision: string | null;
  stage: "unresolved" | "loading" | "reconciled";
};

type ProposalConflictState = {
  action: ProposalAction;
  localRecord: ResearchProfileRecord;
  latestRecord: ResearchProfileRecord | null;
  latestRevision: string | null;
  stage: "unresolved" | "loading" | "reconciled";
};

type ResearchProfilePageProps = {
  project: ProjectRecord | null;
  onNavigate: (page: PageId) => void;
  companionUrl: string;
  sessionToken: string;
  workspaceId: string | null;
  workspaceState: WorkspaceState;
  connectionState: ConnectionState;
  onDirtyChange: (dirty: boolean) => void;
};

function emptyDraft(question = ""): ProfileDraft {
  return {
    central_research_question: question,
    concepts: [],
    synonyms: [],
    theories: [],
    mechanisms: [],
    outcomes: [],
    contexts: [],
    populations: [],
    preferred_disciplines: [],
    preferred_evidence_types: [],
    exclusions: [],
    watched_authors: [],
    search_queries: []
  };
}

function draftFromRecord(record: ResearchProfileRecord): ProfileDraft {
  const draft = emptyDraft(record.central_research_question);
  draft.concepts = (record.concepts ?? []).map((concept) => ({
    term: concept.term,
    weightInput: concept.weight === undefined ? "" : String(concept.weight)
  }));
  for (const field of PROFILE_LIST_FIELDS) {
    draft[field] = [...(record[field] ?? [])];
  }
  return draft;
}

function copyDraft(draft: ProfileDraft): ProfileDraft {
  return {
    ...draft,
    concepts: draft.concepts.map((concept) => ({ ...concept })),
    ...Object.fromEntries(PROFILE_LIST_FIELDS.map((field) => [field, [...draft[field]]]))
  } as ProfileDraft;
}

function sameDraft(left: ProfileDraft | null, right: ProfileDraft | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normaliseDraft(input: ProfileDraft): { draft: ProfileDraft; error: string | null } {
  const draft = copyDraft(input);
  draft.central_research_question = draft.central_research_question.trim();
  if (!draft.central_research_question) {
    return { draft, error: "Research focus: the central research question is required." };
  }

  for (const field of PROFILE_LIST_FIELDS) {
    const values = draft[field].map((value) => value.trim());
    if (values.some((value) => !value)) {
      return { draft, error: `${PROFILE_LIST_LABELS[field]}: entries cannot be empty.` };
    }
    const seen = new Set<string>();
    for (const value of values) {
      const key = value.toLocaleLowerCase();
      if (seen.has(key)) {
        return { draft, error: `${PROFILE_LIST_LABELS[field]}: duplicate entries are not allowed.` };
      }
      seen.add(key);
    }
    draft[field] = values;
  }

  const conceptTerms = new Set<string>();
  for (const concept of draft.concepts) {
    concept.term = concept.term.trim();
    concept.weightInput = concept.weightInput.trim();
    if (!concept.term) return { draft, error: "Research focus: concept terms cannot be empty." };
    const termKey = concept.term.toLocaleLowerCase();
    if (conceptTerms.has(termKey)) return { draft, error: "Research focus: duplicate concepts are not allowed." };
    conceptTerms.add(termKey);
    if (concept.weightInput && !Number.isFinite(Number(concept.weightInput))) {
      return { draft, error: `Research focus: weight for ${concept.term} must be a finite number.` };
    }
  }
  return { draft, error: null };
}

function recordFromDraft(project: ProjectRecord, draft: ProfileDraft, existing: ResearchProfileRecord | null): ResearchProfileRecord {
  const now = new Date().toISOString();
  const record: ResearchProfileRecord = {
    schema_version: existing?.schema_version ?? "m3c.v1",
    research_profile_id: existing?.research_profile_id ?? researchProfileIdForProject(project.project_id),
    project_id: project.project_id,
    central_research_question: draft.central_research_question,
    created_at: existing?.created_at ?? now,
    updated_at: now
  };
  if (existing?.proposals) record.proposals = existing.proposals;
  if (draft.concepts.length) {
    record.concepts = draft.concepts.map((concept) => ({
      term: concept.term,
      ...(concept.weightInput ? { weight: Number(concept.weightInput) } : {})
    }));
  }
  for (const field of PROFILE_LIST_FIELDS) {
    if (draft[field].length) record[field] = [...draft[field]];
  }
  return record;
}

function profileErrorMessage(error: unknown): string {
  if (error instanceof CompanionUnavailableError) return "The local companion is unavailable. Check the connection and try again.";
  if (error instanceof CompanionRequestError) {
    if (error.status === 401) return "The companion session expired. Pair this browser again.";
    if (error.status === 404) return "This workspace or research profile is no longer available. Reopen the workspace.";
    if (error.status === 409) return "This research profile changed elsewhere. Review the conflict below before saving again.";
    if (error.status === 400) return `Research Profile validation failed: ${error.message}`;
    return error.message;
  }
  return error instanceof Error ? error.message : "The research profile operation could not be completed.";
}

function profileBelongsToProject(record: ResearchProfileRecord, project: ProjectRecord): boolean {
  return record.project_id === project.project_id && record.research_profile_id === researchProfileIdForProject(project.project_id);
}

function emptyListInputs(): Record<ProfileListField, string> {
  return Object.fromEntries(PROFILE_LIST_FIELDS.map((field) => [field, ""])) as Record<ProfileListField, string>;
}

function cloneProposalValue(value: ResearchProfileProposalValue): ResearchProfileProposalValue {
  return JSON.parse(JSON.stringify(value)) as ResearchProfileProposalValue;
}

export function ResearchProfilePage({
  project,
  onNavigate,
  companionUrl,
  sessionToken,
  workspaceId,
  workspaceState,
  connectionState,
  onDirtyChange
}: ResearchProfilePageProps) {
  const connected = Boolean(workspaceId && sessionToken && workspaceState === "connected" && connectionState === "online");
  const [loadState, setLoadState] = useState<ProfileLoadState>("idle");
  const [loadError, setLoadError] = useState("");
  const [profileRecord, setProfileRecord] = useState<ResearchProfileRecord | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft | null>(null);
  const [savedDraft, setSavedDraft] = useState<ProfileDraft | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveMessage, setSaveMessage] = useState("");
  const [validationMessage, setValidationMessage] = useState("");
  const [conflictState, setConflictState] = useState<ConflictState | null>(null);
  const [proposalConflict, setProposalConflict] = useState<ProposalConflictState | null>(null);
  const [proposalEdit, setProposalEdit] = useState<{ proposalId: string; value: ResearchProfileProposalValue } | null>(null);
  const [proposalDecision, setProposalDecision] = useState<ProposalAction | null>(null);
  const [proposalMessage, setProposalMessage] = useState("");
  const [proposalState, setProposalState] = useState<SaveState>("idle");
  const [pendingReload, setPendingReload] = useState(false);
  const [newListValues, setNewListValues] = useState<Record<ProfileListField, string>>(emptyListInputs);
  const [newConceptTerm, setNewConceptTerm] = useState("");
  const [newConceptWeight, setNewConceptWeight] = useState("");
  const requestSequence = useRef(0);

  const resetNewInputs = useCallback(() => {
    setNewListValues(emptyListInputs());
    setNewConceptTerm("");
    setNewConceptWeight("");
  }, []);

  const dirty = Boolean(conflictState || proposalConflict || proposalEdit || proposalDecision) || editorMode === "create" || Boolean(draft && savedDraft && !sameDraft(draft, savedDraft));

  useEffect(() => {
    onDirtyChange(dirty);
    return () => onDirtyChange(false);
  }, [dirty, onDirtyChange]);

  const loadProfile = useCallback(async () => {
    if (!connected || !workspaceId || !sessionToken || !project) {
      setLoadState("idle");
      setProfileRecord(null);
      setSelectedRevision(null);
      setDraft(null);
      setSavedDraft(null);
      setEditorMode(null);
      setProposalConflict(null);
      setProposalEdit(null);
      setProposalDecision(null);
      return;
    }
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setLoadState("loading");
    setLoadError("");
    setProfileRecord(null);
    setSelectedRevision(null);
    setDraft(null);
    setSavedDraft(null);
    setEditorMode(null);
    setConflictState(null);
    setProposalConflict(null);
    setProposalEdit(null);
    setProposalDecision(null);
    setProposalMessage("");
    setProposalState("idle");
    resetNewInputs();
    try {
      const listed = await listResearchProfiles(companionUrl, sessionToken, workspaceId);
      if (requestId !== requestSequence.current) return;
      const matches = listed.records.filter((item) => item.record.project_id === project.project_id);
      if (matches.length > 1) throw new Error("Multiple research profiles are associated with this project.");
      if (!matches.length) {
        setLoadState("empty");
        return;
      }
      const response = await readResearchProfile(companionUrl, sessionToken, workspaceId, matches[0].record_id);
      if (requestId !== requestSequence.current) return;
      if (!profileBelongsToProject(response.record, project)) throw new Error("The research profile does not match the selected project.");
      const nextDraft = draftFromRecord(response.record);
      setProfileRecord(response.record);
      setSelectedRevision(response.revision);
      setDraft(nextDraft);
      setSavedDraft(copyDraft(nextDraft));
      setEditorMode("edit");
      setSaveState("idle");
      setLoadState("ready");
    } catch (error) {
      if (requestId === requestSequence.current) {
        setLoadState("error");
        setLoadError(profileErrorMessage(error));
      }
    }
  }, [companionUrl, connected, project, resetNewInputs, sessionToken, workspaceId]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  function startCreateProfile() {
    if (!project) return;
    setDraft(emptyDraft(project.central_research_question));
    setSavedDraft(null);
    setProfileRecord(null);
    setSelectedRevision(null);
    setEditorMode("create");
    setLoadState("ready");
    setSaveState("idle");
    setSaveMessage("");
    setValidationMessage("");
    setConflictState(null);
    setProposalConflict(null);
    setProposalEdit(null);
    setProposalDecision(null);
    setProposalMessage("");
    setProposalState("idle");
    resetNewInputs();
  }

  function updateDraft(field: ProfileDraftField, value: ProfileDraftFieldValue) {
    setDraft((current) => current ? { ...current, [field]: value } as ProfileDraft : current);
    setSaveState("idle");
    setSaveMessage("");
    setValidationMessage("");
  }

  function addListValue(field: ProfileListField) {
    const value = newListValues[field].trim();
    if (!value) {
      setValidationMessage(`${PROFILE_LIST_LABELS[field]}: enter a value before adding it.`);
      return;
    }
    const current = draft?.[field] ?? [];
    if (current.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) {
      setValidationMessage(`${PROFILE_LIST_LABELS[field]}: duplicate entries are not allowed.`);
      return;
    }
    updateDraft(field, [...current, value]);
    setNewListValues((values) => ({ ...values, [field]: "" }));
  }

  function removeListValue(field: ProfileListField, value: string) {
    updateDraft(field, (draft?.[field] ?? []).filter((item) => item !== value));
  }

  function addConcept() {
    const term = newConceptTerm.trim();
    const weightInput = newConceptWeight.trim();
    if (!term) {
      setValidationMessage("Research focus: enter a concept before adding it.");
      return;
    }
    if (weightInput && !Number.isFinite(Number(weightInput))) {
      setValidationMessage("Research focus: concept weight must be a finite number.");
      return;
    }
    const current = draft?.concepts ?? [];
    if (current.some((concept) => concept.term.toLocaleLowerCase() === term.toLocaleLowerCase())) {
      setValidationMessage("Research focus: duplicate concepts are not allowed.");
      return;
    }
    updateDraft("concepts", [...current, { term, weightInput }]);
    setNewConceptTerm("");
    setNewConceptWeight("");
  }

  function removeConcept(index: number) {
    updateDraft("concepts", (draft?.concepts ?? []).filter((_, itemIndex) => itemIndex !== index));
  }

  function updateConcept(index: number, field: keyof ConceptDraft, value: string) {
    updateDraft("concepts", (draft?.concepts ?? []).map((concept, itemIndex) => itemIndex === index ? { ...concept, [field]: value } : concept));
  }

  function proposalById(proposalId: string): ResearchProfileProposal | null {
    return profileRecord?.proposals?.find((proposal) => proposal.proposal_id === proposalId) ?? null;
  }

  function beginProposalAction(action: ProposalAction) {
    const proposal = proposalById(action.proposalId);
    if (!proposal) {
      setProposalMessage("This proposal is no longer available in the active Research Profile.");
      return;
    }
    setProposalMessage("");
    setProposalState("idle");
    if (action.kind === "modify") {
      if (!isActionableProposal(proposal) || proposal.proposed_value === undefined) {
        setProposalMessage("This legacy proposal does not contain the durable values needed for modification.");
        return;
      }
      setProposalEdit({ proposalId: action.proposalId, value: cloneProposalValue(proposal.proposed_value) });
      return;
    }
    setProposalDecision(action);
  }

  async function applyProposalDecision(action: ProposalAction) {
    if (!profileRecord || !selectedRevision || !workspaceId || !sessionToken || !project || (action.kind === "modify" && !action.value)) return;
    const proposal = profileRecord.proposals?.find((item) => item.proposal_id === action.proposalId);
    if (!proposal) {
      setProposalMessage("This proposal is no longer available in the active Research Profile.");
      return;
    }
    let nextRecord: ResearchProfileRecord;
    let blockedReversal = false;
    try {
      if (action.kind === "reverse") {
        const result = buildReversalRecord(profileRecord, proposal, selectedRevision);
        nextRecord = result.record;
        blockedReversal = result.blocked;
      } else {
        const value = action.kind === "modify" ? action.value : proposal.proposed_value;
        if (action.kind !== "reject") {
          if (value === undefined) throw new Error("This proposal does not contain a proposed value.");
          const validation = validateProposalForApplication(profileRecord, proposal, value);
          if (validation) throw new Error(validation);
        }
        nextRecord = buildDecisionRecord(profileRecord, proposal, action, selectedRevision);
      }
    } catch (error) {
      setProposalState("error");
      setProposalMessage(error instanceof Error ? error.message : "The proposal could not be prepared.");
      return;
    }

    setProposalState("saving");
    setProposalMessage("");
    setProposalDecision(null);
    try {
      const response = await writeResearchProfile(companionUrl, sessionToken, workspaceId, nextRecord, selectedRevision);
      if (!profileBelongsToProject(response.record, project)) {
        throw new Error("The saved proposal does not belong to the active project.");
      }
      const nextDraft = draftFromRecord(response.record);
      setProfileRecord(response.record);
      setSelectedRevision(response.revision);
      setDraft(nextDraft);
      setSavedDraft(copyDraft(nextDraft));
      setEditorMode("edit");
      setProposalEdit(null);
      setProposalConflict(null);
      setProposalState("saved");
      setProposalMessage(blockedReversal ? "Reversal blocked. The profile changed after this proposal was applied; no value was overwritten." : "Proposal decision saved to the local workspace.");
    } catch (error) {
      setProposalState("error");
      if (error instanceof CompanionRequestError && error.status === 409) {
        setProposalConflict({ action, localRecord: nextRecord, latestRecord: null, latestRevision: null, stage: "unresolved" });
        setProposalMessage("This proposal decision is blocked by a newer Research Profile revision. Fetch the latest profile before retrying.");
      } else {
        setProposalMessage(profileErrorMessage(error));
      }
    }
  }

  function reconcileProposalConflict() {
    if (!proposalConflict || !profileRecord || !workspaceId || !sessionToken) return;
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setProposalConflict({ ...proposalConflict, stage: "loading" });
    void readResearchProfile(companionUrl, sessionToken, workspaceId, profileRecord.research_profile_id).then((response) => {
      if (requestId !== requestSequence.current) return;
      if (project && !profileBelongsToProject(response.record, project)) throw new Error("The latest profile does not match the active project.");
      const nextDraft = draftFromRecord(response.record);
      setProfileRecord(response.record);
      setSelectedRevision(response.revision);
      setDraft(nextDraft);
      setSavedDraft(copyDraft(nextDraft));
      setProposalConflict((current) => current ? { ...current, latestRecord: response.record, latestRevision: response.revision, stage: "reconciled" } : current);
      setProposalMessage("Latest profile loaded. Compare the proposal state, then retry it explicitly or use the latest state.");
    }).catch((error: unknown) => {
      if (requestId !== requestSequence.current) return;
      setProposalConflict((current) => current ? { ...current, stage: "unresolved" } : current);
      setProposalState("error");
      setProposalMessage(profileErrorMessage(error));
    });
  }

  function useLatestProposalState() {
    setProposalConflict(null);
    setProposalEdit(null);
    setProposalDecision(null);
    setProposalMessage("Latest Research Profile state selected. No proposal decision was applied.");
    setProposalState("idle");
  }

  function retryProposalDecision() {
    if (!proposalConflict) return;
    const action = proposalConflict.action;
    setProposalConflict(null);
    void applyProposalDecision(action);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!project || !draft || !workspaceId || !sessionToken || saveState === "saving" || conflictState || proposalConflict || proposalEdit || proposalDecision) return;
    const normalised = normaliseDraft(draft);
    if (normalised.error) {
      setValidationMessage(normalised.error);
      setSaveState("error");
      return;
    }
    setSaveState("saving");
    setSaveMessage("");
    setValidationMessage("");
    try {
      if (editorMode === "create") {
        const listed = await listResearchProfiles(companionUrl, sessionToken, workspaceId);
        if (listed.records.some((item) => item.record.project_id === project.project_id)) {
          setSaveState("error");
          setSaveMessage("A Research Profile already exists for this project. Reload the profile instead of creating another.");
          return;
        }
      }
      const record = recordFromDraft(project, normalised.draft, profileRecord);
      const response = await writeResearchProfile(companionUrl, sessionToken, workspaceId, record, editorMode === "edit" ? selectedRevision ?? undefined : undefined);
      if (!profileBelongsToProject(response.record, project)) throw new Error("The saved research profile does not match the selected project.");
      const confirmedDraft = draftFromRecord(response.record);
      setProfileRecord(response.record);
      setSelectedRevision(response.revision);
      setDraft(confirmedDraft);
      setSavedDraft(copyDraft(confirmedDraft));
      setEditorMode("edit");
      setLoadState("ready");
      setSaveState("saved");
      setSaveMessage("Research Profile saved to the local workspace.");
    } catch (error) {
      setSaveState("error");
      if (error instanceof CompanionRequestError && error.status === 409) {
        setConflictState({ localDraft: copyDraft(draft), latestDraft: null, latestRevision: null, stage: "unresolved" });
        if (editorMode === "create") setSaveMessage("A Research Profile was created elsewhere. Reload the profile before editing again.");
      }
      if (!(editorMode === "create" && error instanceof CompanionRequestError && error.status === 409)) setSaveMessage(profileErrorMessage(error));
    }
  }

  async function reloadLatest() {
    if (!project || !workspaceId || !sessionToken || !profileRecord) return;
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    try {
      const response = await readResearchProfile(companionUrl, sessionToken, workspaceId, profileRecord.research_profile_id);
      if (requestId !== requestSequence.current) return;
      if (!profileBelongsToProject(response.record, project)) throw new Error("The loaded research profile does not match the selected project.");
      const nextDraft = draftFromRecord(response.record);
      setProfileRecord(response.record);
      setSelectedRevision(response.revision);
      setDraft(nextDraft);
      setSavedDraft(copyDraft(nextDraft));
      setConflictState(null);
      setProposalConflict(null);
      setProposalEdit(null);
      setProposalDecision(null);
      setProposalMessage("");
      setProposalState("idle");
      setSaveState("idle");
      setSaveMessage("Latest Research Profile version loaded.");
    } catch (error) {
      if (requestId === requestSequence.current) {
        setSaveState("error");
        setSaveMessage(profileErrorMessage(error));
      }
    }
  }

  function requestReloadLatest() {
    if (dirty) setPendingReload(true);
    else void reloadLatest();
  }

  function preserveUnsavedEdits() {
    if (!conflictState || conflictState.stage !== "unresolved" || !project || !workspaceId || !sessionToken || !profileRecord) return;
    const localDraft = copyDraft(conflictState.localDraft);
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    setConflictState({ ...conflictState, stage: "loading" });
    void readResearchProfile(companionUrl, sessionToken, workspaceId, profileRecord.research_profile_id).then((response) => {
      if (requestId !== requestSequence.current) return;
      if (!profileBelongsToProject(response.record, project)) throw new Error("The loaded research profile does not match the selected project.");
      const latestDraft = draftFromRecord(response.record);
      setProfileRecord(response.record);
      setSelectedRevision(response.revision);
      setDraft(latestDraft);
      setSavedDraft(copyDraft(latestDraft));
      setConflictState({ localDraft, latestDraft, latestRevision: response.revision, stage: "reconciled" });
      setSaveState("idle");
      setSaveMessage("Latest version loaded. Choose which edits to keep before saving.");
    }).catch((error: unknown) => {
      if (requestId !== requestSequence.current) return;
      setConflictState((current) => current ? { ...current, stage: "unresolved" } : current);
      setSaveState("error");
      setSaveMessage(profileErrorMessage(error));
    });
  }

  function useLatestVersion() {
    if (!conflictState?.latestDraft || !conflictState.latestRevision) return;
    setDraft(copyDraft(conflictState.latestDraft));
    setSavedDraft(copyDraft(conflictState.latestDraft));
    setSelectedRevision(conflictState.latestRevision);
    setConflictState(null);
    setSaveState("idle");
    setSaveMessage("Latest Research Profile version selected.");
  }

  function usePreservedVersion() {
    if (!conflictState?.latestDraft || !conflictState.latestRevision) return;
    setDraft(copyDraft(conflictState.localDraft));
    setSavedDraft(copyDraft(conflictState.latestDraft));
    setSelectedRevision(conflictState.latestRevision);
    setConflictState(null);
    setSaveState("idle");
    setSaveMessage("Your preserved edits are ready. Review them and save explicitly.");
  }

  const title = project?.name ?? "Project required";
  const headerAction = <div className="profile-header-actions"><Button type="button" variant="secondary" onClick={() => onNavigate("projects")}>Back to Projects</Button>{editorMode ? <Button type="button" variant="secondary" onClick={requestReloadLatest} icon={<RefreshCw size={15} />}>Reload profile</Button> : null}</div>;

  return (
    <div className="page">
      <PageHeader eyebrow="Research Profile" title={title} description={project ? "Explicit research scope for the selected persisted project." : "Open a persisted project before editing its Research Profile."} action={headerAction} />
      {!connected ? <Card className="profile-connection-card"><SectionHeading title="Research Profile unavailable" action={<StatusPill tone={connectionState === "offline" ? "danger" : "warning"}>{connectionState === "offline" ? "Companion unavailable" : workspaceId ? "Workspace unavailable" : "No workspace"}</StatusPill>} /><p className="muted-copy">Pair the browser and connect a healthy workspace from Onboarding before opening a persisted Research Profile.</p></Card> : null}
      {connected && !project ? <Card className="profile-connection-card"><EmptyState title="Project required" description="Open a persisted project from Projects before viewing or creating its Research Profile." /><Button type="button" variant="primary" onClick={() => onNavigate("projects")}>Open Projects</Button></Card> : null}
      {connected && project && loadState === "loading" ? <p className="workspace-status" role="status">Loading the Research Profile for {project.name}...</p> : null}
      {connected && project && loadState === "error" ? <div className="project-error" role="alert"><AlertTriangle size={18} aria-hidden="true" /><span>{loadError}</span><Button type="button" variant="secondary" onClick={() => void loadProfile()} icon={<RefreshCw size={15} />}>Retry</Button></div> : null}
      {connected && project && loadState === "empty" ? <Card className="profile-empty-state"><StatusPill tone="muted">Not created</StatusPill><h2>No Research Profile yet</h2><p className="muted-copy">Create an explicit profile for {project.name}. The central question will start from the persisted project and nothing will be saved until you confirm.</p><Button type="button" variant="primary" onClick={startCreateProfile} icon={<Plus size={16} />}>Create Research Profile</Button></Card> : null}
      {connected && project && editorMode && draft ? <>
        <ProfileEditor draft={draft} mode={editorMode} dirty={dirty} proposalDirty={Boolean(proposalConflict || proposalEdit || proposalDecision)} saveState={saveState} saveMessage={saveMessage} validationMessage={validationMessage} conflict={conflictState} newListValues={newListValues} newConceptTerm={newConceptTerm} newConceptWeight={newConceptWeight} onChange={updateDraft} onSave={saveProfile} onListInputChange={(field, value) => setNewListValues((values) => ({ ...values, [field]: value }))} onAddList={addListValue} onRemoveList={removeListValue} onConceptTermChange={setNewConceptTerm} onConceptWeightChange={setNewConceptWeight} onAddConcept={addConcept} onRemoveConcept={removeConcept} onUpdateConcept={updateConcept} onReloadLatest={requestReloadLatest} onPreserveUnsaved={preserveUnsavedEdits} onUseLatest={useLatestVersion} onUsePreserved={usePreservedVersion} />
        {profileRecord ? <ProposalReview profile={profileRecord} editing={proposalEdit} message={proposalMessage} state={proposalState} conflict={proposalConflict} onAction={beginProposalAction} onEditChange={(value) => setProposalEdit((current) => current ? { ...current, value } : current)} onCancelEdit={() => setProposalEdit(null)} onApplyEdit={() => proposalEdit && setProposalDecision({ kind: "modify", proposalId: proposalEdit.proposalId, value: proposalEdit.value })} onReconcile={reconcileProposalConflict} onUseLatest={useLatestProposalState} onRetry={retryProposalDecision} /> : null}
      </> : null}
      <Modal open={pendingReload} eyebrow="Unsaved Research Profile" title="Discard unsaved profile edits?" onClose={() => setPendingReload(false)}><p className="muted-copy">Reloading replaces the current editor with the persisted profile version.</p><div className="inline-actions"><Button type="button" variant="secondary" onClick={() => setPendingReload(false)}>Keep editing</Button><Button type="button" variant="primary" onClick={() => { setPendingReload(false); void reloadLatest(); }}>Discard edits and continue</Button></div></Modal>
      <Modal open={proposalDecision !== null} eyebrow="Requires your approval" title={proposalDecision?.kind === "reject" ? "Reject this proposal?" : proposalDecision?.kind === "reverse" ? "Reverse this profile change?" : "Apply this profile change?"} onClose={() => setProposalDecision(null)}>
        <p className="muted-copy">{proposalDecision?.kind === "reject" ? "The proposal will remain in decision history and will not change the Research Profile." : proposalDecision?.kind === "reverse" ? "The prior profile value will be restored only if the field is unchanged since application." : "The exact proposed value will be written to the persisted Research Profile after this confirmation."}</p>
        <div className="inline-actions"><Button type="button" variant="secondary" onClick={() => setProposalDecision(null)}>Keep reviewing</Button><Button type="button" variant="primary" onClick={() => proposalDecision && void applyProposalDecision(proposalDecision)}>{proposalDecision?.kind === "reject" ? "Reject proposal" : proposalDecision?.kind === "reverse" ? "Reverse proposal" : "Apply proposal change"}</Button></div>
      </Modal>
    </div>
  );
}

function ProfileEditor({
  draft,
  mode,
  dirty,
  proposalDirty,
  saveState,
  saveMessage,
  validationMessage,
  conflict,
  newListValues,
  newConceptTerm,
  newConceptWeight,
  onChange,
  onSave,
  onListInputChange,
  onAddList,
  onRemoveList,
  onConceptTermChange,
  onConceptWeightChange,
  onAddConcept,
  onRemoveConcept,
  onUpdateConcept,
  onReloadLatest,
  onPreserveUnsaved,
  onUseLatest,
  onUsePreserved
}: {
  draft: ProfileDraft;
  mode: EditorMode;
  dirty: boolean;
  proposalDirty: boolean;
  saveState: SaveState;
  saveMessage: string;
  validationMessage: string;
  conflict: ConflictState | null;
  newListValues: Record<ProfileListField, string>;
  newConceptTerm: string;
  newConceptWeight: string;
  onChange: (field: "central_research_question" | ProfileListField | "concepts", value: string | string[] | ConceptDraft[]) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onListInputChange: (field: ProfileListField, value: string) => void;
  onAddList: (field: ProfileListField) => void;
  onRemoveList: (field: ProfileListField, value: string) => void;
  onConceptTermChange: (value: string) => void;
  onConceptWeightChange: (value: string) => void;
  onAddConcept: () => void;
  onRemoveConcept: (index: number) => void;
  onUpdateConcept: (index: number, field: keyof ConceptDraft, value: string) => void;
  onReloadLatest: () => void;
  onPreserveUnsaved: () => void;
  onUseLatest: () => void;
  onUsePreserved: () => void;
}) {
  return <form className="profile-editor" onSubmit={onSave} aria-label={mode === "create" ? "Create Research Profile" : "Edit Research Profile"}>
    <div className="card-heading"><div><p className="eyebrow">{mode === "create" ? "New Research Profile" : "Persisted Research Profile"}</p><h2>{mode === "create" ? "Define the research scope" : "Research scope"}</h2></div><StatusPill tone={dirty ? "warning" : "accent"}>{dirty ? "Unsaved" : "Up to date"}</StatusPill></div>
    <p className="profile-editor-note">All fields are explicit user-authored scope. Profile updates are prepared for review and never applied without your approval.</p>
    <Card className="profile-editor-section"><SectionHeading title="Research focus" /><label htmlFor="profile-question">Central research question</label><textarea id="profile-question" rows={4} value={draft.central_research_question} onChange={(event) => onChange("central_research_question", event.target.value)} placeholder="What question does this project investigate?" /><ConceptEditor concepts={draft.concepts} newTerm={newConceptTerm} newWeight={newConceptWeight} onTermChange={onConceptTermChange} onWeightChange={onConceptWeightChange} onAdd={onAddConcept} onRemove={onRemoveConcept} onUpdate={onUpdateConcept} /><ListEditor field="synonyms" values={draft.synonyms} inputValue={newListValues.synonyms} onInputChange={onListInputChange} onAdd={onAddList} onRemove={onRemoveList} /></Card>
    <Card className="profile-editor-section"><SectionHeading title="Theoretical structure" />{PROFILE_LIST_FIELDS.filter((field) => ["theories", "mechanisms", "outcomes"].includes(field)).map((field) => <ListEditor key={field} field={field} values={draft[field]} inputValue={newListValues[field]} onInputChange={onListInputChange} onAdd={onAddList} onRemove={onRemoveList} />)}</Card>
    <Card className="profile-editor-section"><SectionHeading title="Scope" />{PROFILE_LIST_FIELDS.filter((field) => ["contexts", "populations", "preferred_disciplines", "preferred_evidence_types"].includes(field)).map((field) => <ListEditor key={field} field={field} values={draft[field]} inputValue={newListValues[field]} onInputChange={onListInputChange} onAdd={onAddList} onRemove={onRemoveList} />)}</Card>
    <Card className="profile-editor-section"><SectionHeading title="Search guidance" />{PROFILE_LIST_FIELDS.filter((field) => ["exclusions", "watched_authors", "search_queries"].includes(field)).map((field) => <ListEditor key={field} field={field} values={draft[field]} inputValue={newListValues[field]} onInputChange={onListInputChange} onAdd={onAddList} onRemove={onRemoveList} />)}</Card>
    {validationMessage ? <p className="error-message" role="alert">{validationMessage}</p> : null}
    {saveMessage ? <p className={saveState === "error" ? "error-message" : "success-message"} role={saveState === "error" ? "alert" : "status"}>{saveMessage}</p> : null}
    {conflict ? <div className="project-conflict profile-conflict" role="alert"><strong>This Research Profile has a newer revision.</strong>{conflict.stage === "unresolved" ? <><p>Your local edits remain visible, but Save is blocked until the latest profile is fetched. Reload it, or preserve these edits for explicit comparison.</p><div className="inline-actions"><Button type="button" variant="secondary" onClick={onReloadLatest} icon={<RefreshCw size={15} />}>Reload latest and discard my edits</Button><Button type="button" variant="ghost" onClick={onPreserveUnsaved} icon={<Edit3 size={15} />}>Preserve my edits for reconciliation</Button></div></> : null}{conflict.stage === "loading" ? <p role="status">Loading the latest saved profile before reconciliation...</p> : null}{conflict.stage === "reconciled" && conflict.latestDraft ? <><p>Choose one complete version before saving. Neither choice is written automatically.</p><div className="profile-conflict-values"><ProfileDraftSummary title="Latest saved version" draft={conflict.latestDraft} /><ProfileDraftSummary title="Preserved local edits" draft={conflict.localDraft} /></div><div className="inline-actions"><Button type="button" variant="secondary" onClick={onUseLatest}>Use latest saved version</Button><Button type="button" variant="primary" onClick={onUsePreserved} icon={<Edit3 size={15} />}>Use my preserved edits</Button></div></> : null}</div> : null}
    <div className="inline-actions profile-editor-actions"><Button type="submit" variant="primary" disabled={!dirty || proposalDirty || saveState === "saving" || conflict !== null} icon={saveState === "saving" ? <RefreshCw size={15} /> : <Save size={15} />}>{saveState === "saving" ? "Saving..." : "Save Research Profile"}</Button>{saveState === "saved" ? <span className="saved-indicator"><Check size={15} aria-hidden="true" /> Saved locally</span> : null}</div>
  </form>;
}

function proposalValueText(value: ResearchProfileProposalValue | undefined): string {
  if (value === undefined) return "Unavailable in this legacy proposal";
  if (Array.isArray(value)) return value.map((item) => item.weight === undefined ? item.term : `${item.term} (${item.weight})`).join(", ") || "None";
  return value.values.join(", ") || "None";
}

function ProposalValueEditor({ value, onChange }: { value: ResearchProfileProposalValue; onChange: (value: ResearchProfileProposalValue) => void }) {
  const [draftValue, setDraftValue] = useState<ResearchProfileProposalValue>(value);
  const valueKey = JSON.stringify(value);
  useEffect(() => setDraftValue(value), [valueKey]);
  function commit(next: ResearchProfileProposalValue) {
    setDraftValue(next);
    onChange(next);
  }
  if (Array.isArray(draftValue)) {
    return <div className="proposal-value-editor" aria-label="Edit proposed concept weights">{draftValue.map((concept, index) => <div className="profile-concept-row" key={`modified-concept-${index}`}><input aria-label={`Modified concept term ${index + 1}`} value={concept.term} onChange={(event) => commit(draftValue.map((item, itemIndex) => itemIndex === index ? { ...item, term: event.target.value } : item))} /><input aria-label={`Modified concept weight ${index + 1}`} type="number" step="any" value={concept.weight ?? ""} onChange={(event) => commit(draftValue.map((item, itemIndex) => itemIndex === index ? { ...item, weight: event.target.value === "" ? undefined : Number(event.target.value) } : item))} /><Button type="button" variant="ghost" className="icon-button" aria-label={`Remove modified concept ${concept.term || index + 1}`} onClick={() => commit(draftValue.filter((_, itemIndex) => itemIndex !== index))} icon={<X size={14} />} /></div>)}</div>;
  }
  const listValue = draftValue as { values: string[] };
  return <div className="proposal-value-editor" aria-label="Edit proposed list values">{listValue.values.map((item, index) => <div className="profile-add-row" key={`modified-value-${index}`}><input aria-label={`Modified proposal value ${index + 1}`} value={item} onChange={(event) => commit({ values: listValue.values.map((current, itemIndex) => itemIndex === index ? event.target.value : current) })} /><Button type="button" variant="ghost" className="icon-button" aria-label={`Remove modified value ${item || index + 1}`} onClick={() => commit({ values: listValue.values.filter((_, itemIndex) => itemIndex !== index) })} icon={<X size={14} />} /></div>)}<Button type="button" variant="secondary" onClick={() => commit({ values: [...listValue.values, ""] })} icon={<Plus size={15} />}>Add value</Button></div>;
}

function ProposalReview({
  profile,
  editing,
  message,
  state,
  conflict,
  onAction,
  onEditChange,
  onCancelEdit,
  onApplyEdit,
  onReconcile,
  onUseLatest,
  onRetry
}: {
  profile: ResearchProfileRecord;
  editing: { proposalId: string; value: ResearchProfileProposalValue } | null;
  message: string;
  state: SaveState;
  conflict: ProposalConflictState | null;
  onAction: (action: ProposalAction) => void;
  onEditChange: (value: ResearchProfileProposalValue) => void;
  onCancelEdit: () => void;
  onApplyEdit: () => void;
  onReconcile: () => void;
  onUseLatest: () => void;
  onRetry: () => void;
}) {
  const proposals = profile.proposals ?? [];
  const pending = proposals.filter((proposal) => proposal.status === "proposed");
  const history = proposals.filter((proposal) => proposal.status !== "proposed");
  return <section className="profile-proposals" aria-labelledby="profile-proposals-title">
    <Card className="profile-editor-section"><div className="card-heading"><div><p className="eyebrow">Transparent profile learning</p><h2 id="profile-proposals-title">Profile change proposals</h2></div><StatusPill tone="muted">Requires your approval</StatusPill></div><p className="profile-editor-note">These are deterministic proposals prepared for review. They are not applied automatically and are not claims about AI learning from papers.</p>
      <SectionHeading title="Pending proposals" />
      {!pending.length ? <p className="muted-copy">No pending proposals for this project.</p> : pending.map((proposal) => {
        const target = proposalTarget(proposal);
        const actionable = isActionableProposal(proposal);
        const current = target ? profileValue(profile, target) : proposal.current_value;
        const isEditing = editing?.proposalId === proposal.proposal_id;
        return <article className="profile-proposal" key={proposal.proposal_id}><div className="card-heading"><div><h3>{proposalTitle(proposal)}</h3><span className="label">{target ? PROPOSAL_TARGET_LABELS[target] : "Legacy proposal"}</span></div><StatusPill tone="warning">Not applied</StatusPill></div><p>{proposal.explanation}</p>{actionable ? <div className="proposal-comparison"><div><span className="label">Current value</span><p>{proposalValueText(current)}</p></div><div><span className="label">Proposed value</span><p>{proposalValueText(proposal.proposed_value)}</p></div></div> : <p className="muted-copy">This older proposal is preserved in history, but it has no durable value payload and cannot be applied safely.</p>}{isEditing && editing ? <div className="proposal-edit-panel"><span className="label">Modify before applying</span><ProposalValueEditor value={editing.value} onChange={onEditChange} /><div className="inline-actions"><Button type="button" variant="secondary" onClick={onCancelEdit}>Cancel modification</Button><Button type="button" variant="primary" disabled={state === "saving"} onClick={onApplyEdit}>Apply modified proposal</Button></div></div> : null}{actionable && !isEditing ? <div className="inline-actions"><Button type="button" variant="primary" onClick={() => onAction({ kind: "accept", proposalId: proposal.proposal_id })}>Accept proposal</Button><Button type="button" variant="secondary" onClick={() => onAction({ kind: "modify", proposalId: proposal.proposal_id, value: proposal.proposed_value! })}>Modify proposal</Button><Button type="button" variant="ghost" onClick={() => onAction({ kind: "reject", proposalId: proposal.proposal_id })}>Reject proposal</Button></div> : null}</article>;
      })}
      <SectionHeading title="Decision history" />
      {!history.length ? <p className="muted-copy">Accepted, modified and rejected proposal decisions will remain here.</p> : history.map((proposal) => <article className="profile-proposal profile-proposal-history" key={proposal.proposal_id}><div className="card-heading"><div><h3>{proposalTitle(proposal)}</h3><span className="label">{proposal.decision_at ? new Date(proposal.decision_at).toLocaleString() : "Decision recorded"}</span></div><StatusPill tone={proposal.status === "reversed" ? "accent" : proposal.reversal_result === "blocked" ? "danger" : "muted"}>{proposal.reversal_result === "blocked" ? "Reversal blocked" : proposal.status}</StatusPill></div><p>{proposal.explanation}</p><div className="proposal-comparison"><div><span className="label">Proposed value</span><p>{proposalValueText(proposal.proposed_value)}</p></div><div><span className="label">Applied value</span><p>{proposalValueText(proposal.applied_value ?? proposal.modified_value)}</p></div></div>{proposal.status === "accepted" || proposal.status === "modified" ? <Button type="button" variant="secondary" onClick={() => onAction({ kind: "reverse", proposalId: proposal.proposal_id })}>Reverse proposal</Button> : null}</article>)}
      {conflict ? <div className="project-conflict profile-conflict" role="alert"><strong>Proposal decision blocked by a newer profile revision.</strong>{conflict.stage === "unresolved" ? <><p>The decision remains local and uncommitted. Fetch the latest profile before retrying or abandoning it.</p><Button type="button" variant="secondary" onClick={onReconcile} icon={<RefreshCw size={15} />}>Fetch latest profile</Button></> : null}{conflict.stage === "loading" ? <p role="status">Fetching the latest profile for explicit comparison...</p> : null}{conflict.stage === "reconciled" ? <><p>Latest proposal state is loaded. No decision was adopted from the conflict response.</p><div className="inline-actions"><Button type="button" variant="secondary" onClick={onUseLatest}>Use latest and abandon decision</Button><Button type="button" variant="primary" onClick={onRetry}>Retry preserved decision</Button></div></> : null}</div> : null}
      {message ? <p className={state === "error" ? "error-message" : "success-message"} role={state === "error" ? "alert" : "status"}>{message}</p> : null}
    </Card>
  </section>;
}

function ListEditor({ field, values, inputValue, onInputChange, onAdd, onRemove }: { field: ProfileListField; values: string[]; inputValue: string; onInputChange: (field: ProfileListField, value: string) => void; onAdd: (field: ProfileListField) => void; onRemove: (field: ProfileListField, value: string) => void }) {
  const label = PROFILE_LIST_LABELS[field];
  const inputId = `profile-${field}`;
  return <div className="profile-list-editor"><label htmlFor={inputId}>{label}</label><div className="profile-add-row"><input id={inputId} value={inputValue} onChange={(event) => onInputChange(field, event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onAdd(field); } }} placeholder={`Add ${label.toLocaleLowerCase()}`} /><Button type="button" variant="secondary" onClick={() => onAdd(field)} icon={<Plus size={15} />}>Add</Button></div><div className="profile-chip-list" aria-label={`${label} entries`}>{values.map((value) => <span className="profile-chip" key={value}><span>{value}</span><Button type="button" variant="ghost" className="icon-button" aria-label={`Remove ${value}`} onClick={() => onRemove(field, value)} icon={<X size={14} />} /></span>)}</div></div>;
}

function ConceptEditor({ concepts, newTerm, newWeight, onTermChange, onWeightChange, onAdd, onRemove, onUpdate }: { concepts: ConceptDraft[]; newTerm: string; newWeight: string; onTermChange: (value: string) => void; onWeightChange: (value: string) => void; onAdd: () => void; onRemove: (index: number) => void; onUpdate: (index: number, field: keyof ConceptDraft, value: string) => void }) {
  return <div className="profile-list-editor"><label htmlFor="profile-concept-term">Concepts and optional weights</label><div className="profile-add-row profile-concept-add-row"><input id="profile-concept-term" value={newTerm} onChange={(event) => onTermChange(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onAdd(); } }} placeholder="Add a concept" /><input aria-label="New concept weight" type="number" step="any" value={newWeight} onChange={(event) => onWeightChange(event.target.value)} placeholder="Weight (optional)" /><Button type="button" variant="secondary" onClick={onAdd} icon={<Plus size={15} />}>Add</Button></div><div className="profile-concept-list" aria-label="Concept entries">{concepts.map((concept, index) => <div className="profile-concept-row" key={`${concept.term}-${index}`}><input aria-label={`Concept term ${index + 1}`} value={concept.term} onChange={(event) => onUpdate(index, "term", event.target.value)} /><input aria-label={`Concept weight ${index + 1}`} type="number" step="any" value={concept.weightInput} onChange={(event) => onUpdate(index, "weightInput", event.target.value)} placeholder="Weight" /><Button type="button" variant="ghost" className="icon-button" aria-label={`Remove concept ${concept.term || index + 1}`} onClick={() => onRemove(index)} icon={<X size={14} />} /></div>)}</div></div>;
}

function ProfileDraftSummary({ title, draft }: { title: string; draft: ProfileDraft }) {
  const listCount = PROFILE_LIST_FIELDS.reduce((count, field) => count + draft[field].length, 0);
  return <div className="profile-draft-summary"><strong>{title}</strong><span className="label">Central question</span><p>{draft.central_research_question}</p><span className="label">Concepts</span><p>{draft.concepts.map((concept) => concept.weightInput ? `${concept.term} (${concept.weightInput})` : concept.term).join(", ") || "None"}</p><span className="label">List entries</span><p>{listCount}</p></div>;
}
