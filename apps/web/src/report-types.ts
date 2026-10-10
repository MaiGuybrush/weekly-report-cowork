// JSON contract of the data repo: weeks/<week>/{s1,s2,s3,cross}.json and publications/index.json.

export type ItemDetails = {
  effectiveDate?: string;
  handover?: string;
  impact?: string;
  nextStep?: string;
  sourceLinks?: { label: string; url: string }[];
  pendingDecision?: { description: string; result?: string; newDueDate?: string; requiresFollowUp?: boolean };
  previousCommitment?: string;
};

export type ScheduleEntry = {
  id: string;
  kind: "phase" | "task" | "milestone";
  name: string;
  owner?: string | null;
  phaseId?: string | null;
  state: "open" | "in-progress" | "completed" | "cancelled" | "pending" | "achieved";
  baselineStart: string | null;
  baselineEnd: string | null;
  forecastStart: string | null;
  forecastEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  baselineDate?: string | null;
  forecastDate?: string | null;
  actualDate?: string | null;
  predecessors?: string[];
  evidenceLinks?: { workId: number; summary: string }[];
};

export type ExternalDependency = {
  id: string;
  description: string;
  supplier: string;
  dueDate: string;
  status: string;
  linkedEntryIds: string[];
};

export type NonProjectSection = "incidents" | "operations" | "personnel" | "technology" | "appendix";
export type SectionName = NonProjectSection | "projects";

export type SectionItem = {
  id: string;
  section: SectionName;
  title: string;
  content: string;
  details: ItemDetails;
  // project items only (edited in the schedule screen)
  owner?: string;
  participants?: string[];
  schedule?: ScheduleEntry[];
  externalDependencies?: ExternalDependency[];
};

export type SectionFile = { week: string; section: string; items: SectionItem[] };
export type CrossFile = { week: string; managementSummary: string; pendingDecisions: { id: string; description: string; result?: string; newDueDate?: string }[] };
export type PublicationIndex = { publications: { week: string; version: number; publishedAt: string; publishedBy: string; path: string }[] };
