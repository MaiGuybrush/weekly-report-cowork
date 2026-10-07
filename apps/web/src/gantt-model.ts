export type GanttEntry = {
  id: string;
  kind: "phase" | "task" | "milestone";
  name: string;
  owner?: string | null;
  phaseId?: string | null;
  baselineStart: string | null;
  baselineEnd: string | null;
  forecastStart: string | null;
  forecastEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  baselineDate?: string | null;
  forecastDate?: string | null;
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
    .flatMap((e) => [e.baselineStart, e.baselineEnd, e.forecastStart, e.forecastEnd, e.actualStart, e.actualEnd, e.baselineDate, e.forecastDate, e.actualDate])
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
  const [base, end] = entry.kind === "milestone"
    ? [entry.baselineDate, entry.state === "achieved" ? entry.actualDate : entry.forecastDate]
    : [entry.baselineEnd, entry.actualEnd || entry.forecastEnd];
  return base && end ? Math.round((Date.parse(end) - Date.parse(base)) / DAY) : null;
}

export function varianceText(entry: GanttEntry) {
  const milestone = entry.kind === "milestone";
  if (milestone ? !entry.baselineDate : !entry.baselineEnd) return "無基準";
  const days = varianceDays(entry);
  if (days === null) return milestone ? "—" : "無基準";
  if (days === 0) return milestone ? "如期達成" : "如期";
  return `${days > 0 ? "+" : ""}${days} 天`;
}

export function varianceBadgeClass(entry: GanttEntry) {
  const days = varianceDays(entry);
  return days === null ? "variance-neutral" : days > 0 ? "variance-delayed" : days < 0 ? "variance-ahead" : "variance-ontime";
}

export function stateLabel(state: GanttEntry["state"]) {
  return ({ open: "開放", "in-progress": "進行中", completed: "完成", cancelled: "取消", pending: "待達成", achieved: "已達成" } as Record<string, string>)[state] ?? state;
}
