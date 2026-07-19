import prototypeData from "../../../docs/prototypes/prototype-data.json";
import type { Paper, Project } from "./types";

const projectDescriptions: Record<string, string> = {
  "ai-advice": "Framing, decision type and real interaction dynamics.",
  "news-wellbeing": "How news content predicts population well-being.",
  "token-delegation": "Cost salience and control in agentic AI use."
};

const paperReasons: Record<string, string> = {
  p1: "Directly relevant to repeated interaction, contextual memory and behavioural advice use.",
  p2: "Directly separates advisor framing from observed interaction quality.",
  p3: "Strong theoretical fit on cognitive burden and personal decision delegation.",
  p4: "Synthesises factual and personal decision contexts across advisor types.",
  p5: "Offers a contextual-awareness measure and repeated-session design."
};

const paperProjectId = "ai-advice";
const paperProjectName = "AI versus Human Advice";

export const projects: Project[] = prototypeData.projects.map((project) => ({
  ...project,
  description: projectDescriptions[project.id] ?? "A focused research project.",
  status: project.status as Project["status"]
}));

export const papers: Paper[] = prototypeData.papers.map((paper) => ({
  ...paper,
  type: paper.type as Paper["type"],
  access: paper.access as Paper["access"],
  reason: paperReasons[paper.id] ?? "Relevant evidence for the current research profile.",
  projectId: paperProjectId,
  projectName: paperProjectName
}));

export const paperTypeLabels: Record<Paper["type"], string> = {
  empirical: "Empirical",
  experiment: "Experiment",
  conceptual: "Conceptual",
  review: "Review"
};

export const accessLabels: Record<Paper["access"], string> = {
  pdf_ready: "PDF ready",
  institutional: "Institutional",
  repository: "Repository"
};

export const settingsCopy = {
  workspace: {
    label: "Workspace",
    rows: [
      ["Workspace folder", "Dropbox / Research Intelligence Workspace"],
      ["Processing device", "Emmy's MacBook Pro"],
      ["Backup", "Healthy"]
    ]
  },
  ai: {
    label: "AI & budgets",
    rows: [
      ["Provider", "Bring your own provider; key stored in OS keychain"],
      ["Monthly warning", "£10"],
      ["Hard stop", "£15"]
    ]
  },
  automation: {
    label: "Automation",
    rows: [
      ["Scheduled discovery", "Enabled"],
      ["Full-paper summaries", "Enabled"]
    ]
  },
  institution: {
    label: "Institution",
    rows: [
      ["Institution", "University of Warwick"],
      ["Credentials", "Never stored"]
    ]
  },
  privacy: {
    label: "Privacy",
    rows: [
      ["Default mode", "Full paper with outbound preview"],
      ["Private notes", "Excluded"]
    ]
  },
  "reading-settings": {
    label: "Reading",
    rows: [
      ["Daily target", "2 papers"],
      ["Weekends", "Excluded"]
    ]
  }
} as const;
