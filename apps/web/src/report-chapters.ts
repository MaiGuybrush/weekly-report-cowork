import type { SectionFile, SectionItem, SectionName } from "./report-types";

export type Chapter = { section: SectionName; items: SectionItem[] };

/** Official chapter order; 管理摘要 comes before and the appendix after. */
export const CHAPTER_ORDER: SectionName[] = ["projects", "incidents", "operations", "personnel", "technology"];

/** Merges the three section files into chapters: file order (一、二、三) then in-file order; chapters without items are left out. */
export function chaptersOf(files: (Partial<SectionFile> | undefined)[]): Chapter[] {
  return CHAPTER_ORDER
    .map((section) => ({ section, items: files.flatMap((f) => f?.items ?? []).filter((i) => i.section === section) }))
    .filter((c) => c.items.length);
}
