// JSON contract of the data repo: weeks/<week>/{s1,s2,s3,cross}.json and publications/index.json.

export type ItemDetails = {
  effectiveDate?: string;
  handover?: string;
  impact?: string;
  nextStep?: string;
  sourceLinks?: SourceLink[];
  pendingDecision?: { description: string; result?: string; newDueDate?: string; requiresFollowUp?: boolean };
  previousCommitment?: string;
};

export type SourceLink = { label: string; url: string };

export type ScheduleEntry = {
  id: string;
  kind: "phase" | "task" | "milestone";
  name: string;
  owner?: string | null;
  phaseId?: string | null;
  state: "open" | "in-progress" | "completed" | "cancelled" | "pending" | "achieved";
  planStart: string | null;
  planEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  progress?: number | null;
  forecastEnd?: string | null;
  planDate?: string | null;
  actualDate?: string | null;
  predecessors?: string[];
  workId?: number;
  engineerProgress?: number;
  engineerStatus?: string;
  /** Unconfirmed auto-sync: the state/progress this task had before the engineer upload changed it. Never in the published document. */
  pendingSync?: { state: ScheduleEntry["state"]; progress?: number | null; forecastEnd?: string | null };
  /** The head set progress by hand: auto-sync is paused until switched back to following the engineer. */
  progressOverride?: boolean;
  /** Engineer status/percentage of an upload the head reverted; that same upload never overwrites again. */
  rejectedSync?: { status?: string; percentage: number };
};

export type ExternalDependency = {
  id: string;
  description: string;
  supplier: string;
  dueDate: string;
  status: string;
  linkedEntryIds: string[];
};

export type NonProjectSection = "incidents" | "operations" | "personnel" | "technology";
export type SectionName = NonProjectSection | "projects";

export type SectionItem = {
  id: string;
  section: SectionName;
  title: string;
  content: string;
  details: ItemDetails;
  /** 系統別 of a maintenance item; blank or absent = 未分類. */
  system?: string;
  // engineer work this item is bound to (unique site-wide) and its last synced progress/status
  workId?: number;
  engineerProgress?: number;
  engineerStatus?: string;
  // project items only (edited in the schedule screen)
  owner?: string;
  participants?: string[];
  schedule?: ScheduleEntry[];
  externalDependencies?: ExternalDependency[];
};

export type SectionFile = { week: string; section: string; items: SectionItem[] };
export type CrossFile = { week: string; managementSummary: string; pendingDecisions: { id: string; description: string; result?: string; newDueDate?: string }[] };
export type PublicationIndex = { publications: { week: string; version: number; publishedAt: string; publishedBy: string; path: string }[] };

export const SECTION_LABELS: Record<SectionName, string> = {
  projects: "專案",
  incidents: "系統異常",
  operations: "維護",
  personnel: "人力調整",
  technology: "新技術",
};
/** The publication appendix is generated from bindings, not an editable section. */
export const UNCLASSIFIED_LABEL = "未分類";
export const APPENDIX_LABEL = "工程師工作明細與來源連結";
export const FILE_LABELS: Record<string, string> = { s1: "第一課", s2: "第二課", s3: "第三課" };
