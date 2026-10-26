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

/**
 * Pulls the engineer's latest percentage (and status) into every bound item and key task. Works the upload lacks (absent) keep the last snapshot.
 * Mutates in place; returns how many bound entries were updated. The engineer file's own deltaPert is never read.
 */
export function syncBound(items: SectionItem[], works: EngineerWork[]): number {
  const byId = worksById(works);
  let updated = 0;
  for (const target of [...items, ...items.flatMap((i) => i.schedule ?? [])]) {
    const work = target.workId == null ? undefined : byId.get(target.workId);
    if (!work || work.absent) continue;
    target.engineerProgress = work.percentage;
    // a task keeps progress only while in progress (see setState); other states just record the snapshot
    if ("kind" in target) { if (target.state === "in-progress") target.progress = work.percentage; } else target.engineerStatus = work.status;
    updated++;
  }
  return updated;
}

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
