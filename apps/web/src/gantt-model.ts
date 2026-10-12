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
  warnings?: { message: string }[];
  externalNotices?: { message: string }[];
  evidenceLinks?: unknown[];
};

export type GanttView = { expandTasks: boolean; showCancelled: boolean; expandedPhases: ReadonlySet<string> };

const DAY = 86400000;
const time = (date: string) => new Date(`${date}T00:00:00`).getTime();

function dates(entries: GanttEntry[]) {
  return entries
    .flatMap((e) => [e.planStart, e.planEnd, e.actualStart, e.actualEnd, e.planDate, e.actualDate])
    .filter((d): d is string => !!d)
    .map(time);
}

export type GanttRange = { min: number; max: number };

export function ganttRange(entries: GanttEntry[]): GanttRange | null {
  const all = dates(entries);
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
};

/** Plan/actual shapes for one row; the actual side is absent until it happens. */
export function ganttMarks(entry: GanttEntry): GanttMarks {
  if (entry.kind === "milestone") {
    return { planBar: null, actualBar: null, planDiamond: entry.planDate || null, actualDiamond: entry.actualDate || null };
  }
  const actualStart = entry.actualStart || entry.actualEnd;
  const actualEnd = entry.actualEnd || entry.actualStart;
  return {
    planBar: entry.planStart && entry.planEnd ? { start: entry.planStart, end: entry.planEnd } : null,
    actualBar: actualStart && actualEnd ? { start: actualStart, end: actualEnd } : null,
    planDiamond: null,
    actualDiamond: null,
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
