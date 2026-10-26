import type { EngineerWork } from "./engineer-progress";
import type { NonProjectSection, SectionItem } from "./report-types";

/** A workId may back only one item site-wide, so collect the ids already taken across every section file. */
export function boundWorkIds(files: ({ items?: SectionItem[] } | undefined)[]): Set<number> {
  const ids = files.flatMap((f) => f?.items ?? []).flatMap((i) => (i.workId == null ? [] : [i.workId]));
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
