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

export type SystemGroup = { system: string | null; items: SectionItem[] };

/** Groups maintenance items by trimmed 系統別 in first-appearance order; blank/absent goes to a trailing group with system null. */
export function systemGroupsOf(items: SectionItem[]): SystemGroup[] {
  const groups = new Map<string, SectionItem[]>();
  const unclassified: SectionItem[] = [];
  for (const i of items) {
    const key = i.system?.trim();
    if (!key) unclassified.push(i);
    else groups.set(key, [...(groups.get(key) ?? []), i]);
  }
  const named = [...groups].map(([system, its]) => ({ system, items: its }));
  return unclassified.length ? [...named, { system: null, items: unclassified }] : named;
}
