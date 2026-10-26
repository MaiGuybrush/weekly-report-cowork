import type { EngineerWork } from "./engineer-progress";
import type { NonProjectSection, ScheduleEntry, SectionItem } from "./report-types";

/** A workId may back only one item site-wide, so collect the ids already taken across every section file. */
export function boundWorkIds(files: ({ items?: SectionItem[] } | undefined)[]): Set<number> {
  const items = files.flatMap((f) => f?.items ?? []);
  const ids = [...items, ...items.flatMap((i) => i.schedule ?? [])].flatMap((x) => (x.workId == null ? [] : [x.workId]));
  return new Set(ids);
}

export const canBind = (workId: number, bound: Set<number>) => !bound.has(workId);

/** New non-project item bound to the picked work: title from its content, body from the head's comment; progress is the work's own, never rolled up from children. */
export function itemFromWork(work: EngineerWork, section: NonProjectSection): SectionItem {
  return {
    id: crypto.randomUUID(), section, title: work.workContent, content: work.managerComment ?? "", details: {},
    workId: work.workId, engineerProgress: work.percentage, engineerStatus: work.status,
  };
}

/** New key task bound to the picked work. Plan dates come only from planStartDate/planEndDate (never dueDate); blanks stay null and are flagged by missingPlanDates. */
export function taskFromWork(work: EngineerWork, phaseId: string | null): ScheduleEntry {
  return {
    id: crypto.randomUUID(), kind: "task", name: work.workContent, owner: work.ownerName ?? "", phaseId, state: "open",
    planStart: work.planStartDate || null, planEnd: work.planEndDate || null, actualStart: null, actualEnd: null,
    predecessors: [], workId: work.workId,
  };
}

/** A bound task must carry both plan dates; manual tasks are not held to this. */
export const missingPlanDates = (e: Pick<ScheduleEntry, "kind" | "planStart" | "planEnd"> & { workId?: number }) =>
  e.kind === "task" && e.workId != null && (!e.planStart || !e.planEnd) ? "此任務綁定工程師工作，請填寫計畫起迄" : undefined;

const worksById = (works: EngineerWork[]): Map<number, EngineerWork> =>
  new Map(works.flatMap((w) => [[w.workId, w] as const, ...worksById(w.subItems ?? [])]));

/** Engineer status -> key task state. 中止 is absent on purpose: it only raises a notice (see abortNotice), the head decides. */
export const STATUS_TO_STATE: Record<string, ScheduleEntry["state"]> = {
  已完成: "completed", 處理中: "in-progress", 簽核中: "in-progress", 待發佈: "in-progress", 待執行: "open",
};

/** Moves a bound task to the engineer's state/progress, remembering the first original in pendingSync. Returns whether anything changed. */
function applyToTask(t: ScheduleEntry, status: string | undefined, percentage: number): boolean {
  const state = STATUS_TO_STATE[status ?? ""];
  if (!state || t.state === "cancelled") return false;
  const progress = state === "in-progress" ? percentage : undefined; // progress only means something while in progress (see setState)
  if (t.state === state && (t.progress ?? undefined) === progress) return false;
  t.pendingSync ??= { state: t.state, progress: t.progress, forecastEnd: t.forecastEnd };
  t.state = state;
  t.progress = progress;
  if (state === "completed") t.forecastEnd = undefined;
  return true;
}

/**
 * Pulls the engineer's latest percentage/status into every bound item and key task. Works the upload lacks (absent) keep the last snapshot.
 * Key tasks follow the status table and leave a pendingSync record, unless the head overrode progress or reverted this very upload.
 * Mutates in place; returns how many bound entries were updated. The engineer file's own deltaPert is never read.
 */
export function syncBound(items: SectionItem[], works: EngineerWork[]): number {
  const byId = worksById(works);
  let updated = 0;
  for (const target of [...items, ...items.flatMap((i) => i.schedule ?? [])]) {
    const work = target.workId == null ? undefined : byId.get(target.workId);
    if (!work || work.absent) continue;
    target.engineerProgress = work.percentage;
    target.engineerStatus = work.status;
    if ("kind" in target) {
      const rejected = target.rejectedSync;
      if (rejected && rejected.status === work.status && rejected.percentage === work.percentage) { updated++; continue; }
      delete target.rejectedSync;
      if (!target.progressOverride) applyToTask(target, work.status, work.percentage);
    }
    updated++;
  }
  return updated;
}

/** Keep the auto change. */
export const confirmSync = (t: ScheduleEntry) => { delete t.pendingSync; };

/** Restore the original state/progress; the upload that caused the change will not overwrite again. */
export function revertSync(t: ScheduleEntry) {
  const p = t.pendingSync;
  if (!p) return;
  t.state = p.state;
  t.progress = p.progress;
  t.forecastEnd = p.forecastEnd;
  t.rejectedSync = { status: t.engineerStatus, percentage: t.engineerProgress ?? 0 };
  delete t.pendingSync;
}

/** Progress typed in by hand on a bound task pauses auto-sync and supersedes any unconfirmed change. */
export function overrideProgress(t: ScheduleEntry) {
  if (t.workId == null) return;
  t.progressOverride = true;
  delete t.pendingSync;
}

/** Back to following the engineer: applies the last synced snapshot right away. */
export function followEngineer(t: ScheduleEntry) {
  delete t.progressOverride;
  delete t.rejectedSync;
  if (t.engineerProgress != null) applyToTask(t, t.engineerStatus, t.engineerProgress);
}

/** Unconfirmed auto changes across items (project key tasks). */
export const pendingCount = (items: SectionItem[] = []) => items.reduce((n, i) => n + (i.schedule ?? []).filter((e) => e.pendingSync).length, 0);

/** Shown while paused: the engineer's newest progress when it differs from the head's own. */
export const followHint = (t: ScheduleEntry) =>
  t.progressOverride && t.engineerProgress != null && t.engineerProgress !== (t.progress ?? undefined) ? `工程師最新進度 ${t.engineerProgress}%` : "";

export const abortNotice = (t: ScheduleEntry) => (t.workId != null && t.engineerStatus === "中止" && t.state !== "cancelled" ? "工程師標示中止" : "");

export const missingActualEnd = (t: ScheduleEntry) => (t.kind === "task" && t.workId != null && t.state === "completed" && !t.actualEnd ? "缺實際結束日" : "");

/** workId -> progress recorded in a published snapshot (items and key tasks alike). */
export function baselineOf(files: ({ items?: SectionItem[] } | undefined)[]): Map<number, number> {
  const items = files.flatMap((f) => f?.items ?? []);
  return new Map([...items, ...items.flatMap((i) => i.schedule ?? [])].flatMap((x) => (x.workId == null || x.engineerProgress == null ? [] : [[x.workId, x.engineerProgress] as const])));
}

/** "+10%", "-5%" (negatives shown as is), or "新增" when last week's final version did not carry the work. */
export function deltaText(workId: number | undefined, progress: number | undefined, baseline: Map<number, number>): string {
  if (workId == null || progress == null) return "";
  const base = baseline.get(workId);
  if (base == null) return "新增";
  const d = progress - base;
  return `${d >= 0 ? "+" : ""}${d}%`;
}

/** ISO week before the given YYYY-Www. */
export function previousWeek(week: string): string {
  const [year, w] = [Number(week.slice(0, 4)), Number(week.slice(6))];
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4.getTime() + ((w - 1) * 7 - ((jan4.getUTCDay() + 6) % 7) - 7) * 864e5);
  const thursday = new Date(monday.getTime() + 3 * 864e5);
  const isoYear = thursday.getUTCFullYear();
  const startOfYear = new Date(Date.UTC(isoYear, 0, 4));
  const firstMonday = startOfYear.getTime() - ((startOfYear.getUTCDay() + 6) % 7) * 864e5;
  return `${isoYear}-W${String(Math.round((monday.getTime() - firstMonday) / (7 * 864e5)) + 1).padStart(2, "0")}`;
}

export type AppendixRow = { workId: number; content: string; progress: number | undefined; delta: string };

/** Publication appendix: every bound item and key task, in file → item → task order (stable), so nothing is hand-compiled. */
export function appendixRows(files: ({ items?: SectionItem[] } | undefined)[], baseline: Map<number, number>): AppendixRow[] {
  return files.flatMap((f) => f?.items ?? []).flatMap((i) => [
    { workId: i.workId, content: i.title, progress: i.engineerProgress },
    ...(i.schedule ?? []).map((e) => ({ workId: e.workId, content: e.name, progress: e.engineerProgress })),
  ]).flatMap((r) => (r.workId == null ? [] : [{ ...r, workId: r.workId, delta: deltaText(r.workId, r.progress, baseline) }]));
}
