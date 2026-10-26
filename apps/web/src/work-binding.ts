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
