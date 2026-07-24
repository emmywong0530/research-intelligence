import type {
  ResearchProfileConcept,
  ResearchProfileProposal,
  ResearchProfileProposalHistoryEvent,
  ResearchProfileProposalTarget,
  ResearchProfileProposalValue,
  ResearchProfileRecord
} from "./companionClient";

export const PROPOSAL_TYPE_LABELS: Record<ResearchProfileProposal["type"], string> = {
  changed_concept_weights: "Changed concept weights",
  new_search_terms: "New search terms",
  exclusions: "Proposed exclusions",
  preferred_methods: "Preferred methods",
  positive_semantic_examples: "Positive semantic examples",
  negative_semantic_examples: "Negative semantic examples",
  revised_screening_instructions: "Revised screening instructions"
};

export const PROPOSAL_TARGET_LABELS: Record<ResearchProfileProposalTarget, string> = {
  concepts: "Concept weights",
  search_queries: "Search queries",
  exclusions: "Exclusions",
  preferred_evidence_types: "Preferred evidence types"
};

export type ProposalAction =
  | { kind: "accept" | "reject" | "reverse"; proposalId: string }
  | { kind: "modify"; proposalId: string; value: ResearchProfileProposalValue };

const TYPE_TO_TARGET: Partial<Record<ResearchProfileProposal["type"], ResearchProfileProposalTarget>> = {
  changed_concept_weights: "concepts",
  new_search_terms: "search_queries",
  exclusions: "exclusions",
  preferred_methods: "preferred_evidence_types"
};

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isActionableProposal(proposal: ResearchProfileProposal): boolean {
  return Boolean(
    TYPE_TO_TARGET[proposal.type] &&
      proposal.target_field &&
      proposal.current_value !== undefined &&
      proposal.proposed_value !== undefined
  );
}

export function proposalTarget(proposal: ResearchProfileProposal): ResearchProfileProposalTarget | null {
  return proposal.target_field ?? TYPE_TO_TARGET[proposal.type] ?? null;
}

export function proposalTitle(proposal: ResearchProfileProposal): string {
  return PROPOSAL_TYPE_LABELS[proposal.type] ?? "Proposed profile update";
}

export function profileValue(record: ResearchProfileRecord, target: ResearchProfileProposalTarget): ResearchProfileProposalValue {
  if (target === "concepts") return clone(record.concepts ?? []);
  return { values: clone(record[target] ?? []) };
}

export function valuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validateConcepts(value: ResearchProfileProposalValue, label: string): string | null {
  if (!Array.isArray(value)) return `${label} must be a list of concepts.`;
  const seen = new Set<string>();
  for (const concept of value) {
    if (!concept || typeof concept !== "object" || typeof concept.term !== "string" || !concept.term.trim()) {
      return `${label} contains an empty concept term.`;
    }
    const key = concept.term.trim().toLocaleLowerCase();
    if (seen.has(key)) return `${label} contains duplicate concepts.`;
    seen.add(key);
    if (concept.weight !== undefined && (!Number.isFinite(concept.weight) || typeof concept.weight === "boolean")) {
      return `${label} weights must be finite numbers.`;
    }
  }
  return null;
}

function validateValues(value: ResearchProfileProposalValue, label: string): string | null {
  if (!value || Array.isArray(value) || typeof value !== "object" || !Array.isArray(value.values)) {
    return `${label} must be a list of values.`;
  }
  const seen = new Set<string>();
  for (const item of value.values) {
    if (typeof item !== "string" || !item.trim()) return `${label} contains an empty value.`;
    const key = item.trim().toLocaleLowerCase();
    if (seen.has(key)) return `${label} contains duplicate values.`;
    seen.add(key);
  }
  return null;
}

export function validateProposalValue(
  target: ResearchProfileProposalTarget,
  value: ResearchProfileProposalValue,
  label: string
): string | null {
  return target === "concepts" ? validateConcepts(value, label) : validateValues(value, label);
}

export function validateProposalForApplication(
  record: ResearchProfileRecord,
  proposal: ResearchProfileProposal,
  value: ResearchProfileProposalValue
): string | null {
  if (proposal.status !== "proposed") return "This proposal has already been decided.";
  const target = proposalTarget(proposal);
  if (!target || !isActionableProposal(proposal)) return "This proposal does not contain an actionable durable value.";
  if (target !== TYPE_TO_TARGET[proposal.type]) return "This proposal type is incompatible with its target field.";
  const valueError = validateProposalValue(target, value, "The proposed value");
  if (valueError) return valueError;
  if (!valuesEqual(profileValue(record, target), proposal.current_value)) {
    return "The profile field changed after this proposal was prepared. Reload and review the proposal before applying it.";
  }
  return null;
}

export function applyProposalValue(
  record: ResearchProfileRecord,
  proposal: ResearchProfileProposal,
  value: ResearchProfileProposalValue
): { record: ResearchProfileRecord; appliedValue: ResearchProfileProposalValue } {
  const target = proposalTarget(proposal);
  if (!target) throw new Error("The proposal has no supported target field.");
  const next = clone(record);
  if (target === "concepts") {
    next.concepts = clone(value as ResearchProfileConcept[]);
    return { record: next, appliedValue: clone(next.concepts) };
  }
  const additions = (value as { values: string[] }).values;
  const existing = [...(next[target] ?? [])];
  const seen = new Set(existing.map((item) => item.toLocaleLowerCase()));
  for (const item of additions) {
    if (!seen.has(item.toLocaleLowerCase())) {
      existing.push(item);
      seen.add(item.toLocaleLowerCase());
    }
  }
  next[target] = existing;
  return { record: next, appliedValue: { values: clone(existing) } };
}

function historyEvent(
  event: ResearchProfileProposalHistoryEvent["event"],
  status: ResearchProfileProposal["status"],
  value: ResearchProfileProposalValue | undefined,
  revision: string,
  note?: string
): ResearchProfileProposalHistoryEvent {
  return {
    event,
    status,
    occurred_at: new Date().toISOString(),
    ...(value === undefined ? {} : { value: clone(value) }),
    revision,
    ...(note ? { note } : {})
  };
}

export function buildDecisionRecord(
  record: ResearchProfileRecord,
  proposal: ResearchProfileProposal,
  action: Exclude<ProposalAction, { kind: "reverse" }>,
  expectedRevision: string
): ResearchProfileRecord {
  const now = new Date().toISOString();
  const proposals = (record.proposals ?? []).map((item) => {
    if (item.proposal_id !== proposal.proposal_id) return item;
    if (action.kind === "reject") {
      return {
        ...item,
        status: "rejected" as const,
        decision_at: now,
        history: [...(item.history ?? []), historyEvent("rejected", "rejected", item.proposed_value, expectedRevision)]
      };
    }
    const value = action.kind === "modify" ? action.value : item.proposed_value;
    if (value === undefined) throw new Error("The proposal has no proposed value.");
    const applied = applyProposalValue(record, item, value);
    const status = action.kind === "modify" ? "modified" as const : "accepted" as const;
    return {
      ...item,
      status,
      modified_value: action.kind === "modify" ? clone(value) : item.modified_value,
      applied_value: clone(applied.appliedValue),
      decision_at: now,
      applied_revision: expectedRevision,
      reversal_result: undefined,
      history: [...(item.history ?? []), historyEvent(status, status, applied.appliedValue, expectedRevision)]
    };
  });
  return { ...record, ...((() => {
    const proposalTargetField = proposalTarget(proposal);
    if (!proposalTargetField || action.kind === "reject") return {};
    const value = action.kind === "modify" ? action.value : proposal.proposed_value;
    if (value === undefined) return {};
    return applyProposalValue(record, proposal, value).record;
  })()), proposals, updated_at: now };
}

export function buildReversalRecord(
  record: ResearchProfileRecord,
  proposal: ResearchProfileProposal,
  expectedRevision: string
): { record: ResearchProfileRecord; blocked: boolean } {
  const target = proposalTarget(proposal);
  if (!target || proposal.applied_value === undefined || proposal.current_value === undefined) {
    throw new Error("This proposal cannot be reversed because its applied snapshot is unavailable.");
  }
  const now = new Date().toISOString();
  const current = profileValue(record, target);
  if (!valuesEqual(current, proposal.applied_value)) {
    const blockedProposal: ResearchProfileProposal = {
      ...proposal,
      reversal_result: "blocked",
      history: [
        ...(proposal.history ?? []),
        historyEvent(
          "reversal_blocked",
          proposal.status,
          current,
          expectedRevision,
          "The profile field changed after this proposal was applied."
        )
      ]
    };
    return {
      record: {
        ...record,
        proposals: (record.proposals ?? []).map((item) => item.proposal_id === proposal.proposal_id ? blockedProposal : item),
        updated_at: now
      },
      blocked: true
    };
  }
  const next = clone(record);
  if (target === "concepts") next.concepts = clone(proposal.current_value as ResearchProfileConcept[]);
  else next[target] = clone((proposal.current_value as { values: string[] }).values);
  next.proposals = (record.proposals ?? []).map((item) => item.proposal_id === proposal.proposal_id ? {
    ...item,
    status: "reversed" as const,
    reversed_at: now,
    reversal_result: "restored" as const,
    history: [...(item.history ?? []), historyEvent("reversed", "reversed", proposal.current_value, expectedRevision)]
  } : item);
  next.updated_at = now;
  return { record: next, blocked: false };
}
