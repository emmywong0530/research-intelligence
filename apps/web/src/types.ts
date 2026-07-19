import type { LucideIcon } from "lucide-react";

export type PageId =
  | "home"
  | "projects"
  | "discovery"
  | "library"
  | "reading"
  | "ask"
  | "profile"
  | "paper"
  | "synthesis"
  | "gaps"
  | "activity"
  | "settings";

export type PrimaryPageId = Exclude<PageId, "profile" | "paper">;
export type DiscoveryView = "table" | "cards" | "field";
export type ProposalState = "pending" | "accepted" | "modified" | "rejected";

export type NavigationItem = {
  id: PrimaryPageId;
  label: string;
  icon: LucideIcon;
};

export type Project = {
  id: string;
  name: string;
  description: string;
  status: "active" | "paused";
  papers: number;
  newPapers: number;
  gap: string;
};

export type Paper = {
  id: string;
  title: string;
  year: number;
  type: "empirical" | "experiment" | "conceptual" | "review";
  match: number;
  access: "pdf_ready" | "institutional" | "repository";
  readingMinutes: number;
  reason: string;
  projectId: string;
  projectName: string;
};

export type SettingsCategory =
  | "workspace"
  | "ai"
  | "automation"
  | "institution"
  | "privacy"
  | "reading-settings";
