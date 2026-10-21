export type GanttEntry = {
  id: string;
  kind: "phase" | "task" | "milestone";
  name: string;
  owner?: string | null;
  phaseId?: string | null;
  planStart: string | null;
  planEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  planDate?: string | null;
  actualDate?: string | null;
  state: "open" | "in-progress" | "completed" | "cancelled" | "pending" | "achieved";
  progress?: number | null;
  warnings?: { message: string }[];
  externalNotices?: { message: string }[];
  evidenceLinks?: { workId: number; summary: string }[];
};

export type GanttView = { expandTasks: boolean; showCancelled: boolean; expandedPhases: ReadonlySet<string> };

const DAY = 86400000;
export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const time = (date: string) => new Date(`${date}T00:00:00`).getTime();

function dates(entries: GanttEntry[], extra: string[] = []) {
  return [...entries.flatMap((e) => [e.planStart, e.planEnd, e.actualStart, e.actualEnd, e.planDate, e.actualDate]), ...extra]
    .filter((d): d is string => !!d)
    .map(time);
}

export type GanttRange = { min: number; max: number };

/** `extra` dates (e.g. today) widen the range so their marker stays on the chart. */
export function ganttRange(entries: GanttEntry[], extra: string[] = []): GanttRange | null {
  const all = dates(entries, extra);
  return all.length ? { min: Math.min(...all), max: Math.max(...all) } : null;
}

export function ganttPosition(range: GanttRange | null, date: string | null | undefined) {
  if (!date || !range || range.max === range.min) return 0;
  return Math.max(0, Math.min(100, ((time(date) - range.min) * 100) / (range.max - range.min)));
}

export function ganttWidth(range: GanttRange | null, start: string | null | undefined, end: string | null | undefined) {
  if (!start || !end) return 2;
  return Math.max(2, ganttPosition(range, end) - ganttPosition(range, start));
}

export function ganttTicks(range: GanttRange | null) {
  if (!range) return [];
  let { min, max } = range;
  if (min === max) {
    min -= DAY * 3;
    max += DAY * 3;
  }
  const count = 4;
  return Array.from({ length: count + 1 }, (_, i) => {
    const d = new Date(min + ((max - min) * i) / count);
    return { percent: (i / count) * 100, label: `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}` };
  });
}

export function ganttDisplayEntries(entries: GanttEntry[], view: GanttView) {
  const active = entries.filter((e) => e.state !== "cancelled");
  const result: GanttEntry[] = [];
  for (const phase of active.filter((e) => e.kind === "phase")) {
    result.push(phase);
    if (view.expandTasks || view.expandedPhases.has(phase.id)) {
      result.push(...active.filter((e) => e.kind === "task" && e.phaseId === phase.id));
    }
  }
  if (view.expandTasks) result.push(...active.filter((e) => e.kind === "task" && !e.phaseId));
  result.push(...active.filter((e) => e.kind === "milestone"));
  if (view.showCancelled) result.push(...entries.filter((e) => e.state === "cancelled"));
  return result;
}

/** Open-by-default views (the editor) list phases that were toggled as collapsed; closed-by-default views list the opened ones. */
export type PhaseOpenState = { expandTasks: boolean; defaultOpen: boolean; toggled: ReadonlySet<string> };
export const isPhaseOpen = (s: PhaseOpenState, phaseId: string) => s.expandTasks || s.defaultOpen !== s.toggled.has(phaseId);

/** Grid order, same grouping as the gantt; cancelled entries stay in their group. Tasks of a missing phase count as direct. */
export function gridRows<T extends GanttEntry>(entries: T[], isOpen: (phaseId: string) => boolean): T[] {
  const phases = entries.filter((e) => e.kind === "phase");
  const tasks = entries.filter((e) => e.kind === "task");
  return [
    ...phases.flatMap((p) => [p, ...(isOpen(p.id) ? tasks.filter((t) => t.phaseId === p.id) : [])]),
    ...tasks.filter((t) => !phases.some((p) => p.id === t.phaseId)),
    ...entries.filter((e) => e.kind === "milestone"),
  ];
}

export function hasChildTasks(entries: GanttEntry[], phaseId: string, showCancelled: boolean) {
  return entries.some((e) => e.kind === "task" && e.phaseId === phaseId && (showCancelled || e.state !== "cancelled"));
}

function varianceDays(entry: GanttEntry): number | null {
  const [base, end] = entry.kind === "milestone" ? [entry.planDate, entry.actualDate] : [entry.planEnd, entry.actualEnd];
  return base && end ? Math.round((Date.parse(end) - Date.parse(base)) / DAY) : null;
}

export function varianceText(entry: GanttEntry) {
  const milestone = entry.kind === "milestone";
  if (milestone ? !entry.planDate : !entry.planEnd) return "無基準";
  const days = varianceDays(entry);
  if (days === null) return "—";
  if (days === 0) return milestone ? "如期達成" : "如期";
  return `${days > 0 ? "+" : ""}${days} 天`;
}

export function varianceBadgeClass(entry: GanttEntry) {
  const days = varianceDays(entry);
  return days === null ? "variance-neutral" : days > 0 ? "variance-delayed" : days < 0 ? "variance-ahead" : "variance-ontime";
}

export type GanttMarks = {
  planBar: { start: string; end: string } | null;
  actualBar: { start: string; end: string } | null;
  planDiamond: string | null;
  actualDiamond: string | null;
  /** Style classes for the actual side: "late" (past plan end) and/or "running" (not finished yet). */
  actualClass: string;
};

/** Plan/actual shapes for one row; the actual side is absent until it happens. A running bar reaches today. */
export function ganttMarks(entry: GanttEntry, today = localToday()): GanttMarks {
  const cls = (late: boolean, running: boolean) => [late && "late", running && "running"].filter(Boolean).join(" ");
  if (entry.kind === "milestone") {
    const late = !!entry.planDate && !!entry.actualDate && entry.actualDate > entry.planDate;
    return { planBar: null, actualBar: null, planDiamond: entry.planDate || null, actualDiamond: entry.actualDate || null, actualClass: cls(late, false) };
  }
  const actualStart = entry.actualStart || entry.actualEnd;
  const running = !entry.actualEnd && !!actualStart;
  const actualEnd = entry.actualEnd || (running && today > actualStart! ? today : actualStart);
  const late = !!entry.planEnd && (entry.actualEnd || today) > entry.planEnd && !!actualStart;
  return {
    planBar: entry.planStart && entry.planEnd ? { start: entry.planStart, end: entry.planEnd } : null,
    actualBar: actualStart && actualEnd ? { start: actualStart, end: actualEnd } : null,
    planDiamond: null,
    actualDiamond: null,
    actualClass: cls(late, running),
  };
}

export function ganttTooltip(entry: GanttEntry) {
  const range = (a: string | null, b: string | null, open: string) => (a || b ? `${a || "—"} ~ ${b || open}` : "—");
  const plan = entry.kind === "milestone" ? entry.planDate || "—" : range(entry.planStart, entry.planEnd, "—");
  const actual = entry.kind === "milestone" ? entry.actualDate || "—" : range(entry.actualStart, entry.actualEnd, "進行中");
  return `計畫：${plan}\n實際：${actual}\n偏差：${varianceText(entry)}`;
}

export function stateLabel(state: GanttEntry["state"]) {
  return ({ open: "開放", "in-progress": "進行中", completed: "完成", cancelled: "取消", pending: "待達成", achieved: "已達成" } as Record<string, string>)[state] ?? state;
}

export type TaskDrop = { before: string } | { after: string } | { intoPhase: string } | { direct: true };

/** Moves one task by reordering the array and reassigning its phase; grid and gantt both derive order from the array. */
export function moveTask<T extends GanttEntry>(entries: T[], taskId: string, drop: TaskDrop): T[] {
  const task = entries.find((e) => e.id === taskId);
  if (!task || task.kind !== "task") return entries;
  const rest = entries.filter((e) => e !== task);
  const index = (pred: (e: T) => boolean) => rest.map(pred).lastIndexOf(true);
  const isPhase = (id?: string | null) => rest.some((e) => e.kind === "phase" && e.id === id);
  let phaseId: string | null;
  let at: number;
  if ("direct" in drop) {
    phaseId = null;
    const last = index((e) => e.kind === "task" && !isPhase(e.phaseId));
    at = last >= 0 ? last + 1 : rest.length;
  } else if ("intoPhase" in drop) {
    phaseId = drop.intoPhase;
    const last = index((e) => e.kind === "task" && e.phaseId === phaseId);
    at = (last >= 0 ? last : rest.findIndex((e) => e.id === phaseId)) + 1;
  } else {
    const targetId = "before" in drop ? drop.before : drop.after;
    const target = rest.findIndex((e) => e.id === targetId);
    if (target < 0) return entries;
    phaseId = rest[target].phaseId && isPhase(rest[target].phaseId) ? rest[target].phaseId! : null;
    at = "before" in drop ? target : target + 1;
  }
  return [...rest.slice(0, at), { ...task, phaseId }, ...rest.slice(at)];
}
