import type { NonProjectSection } from "./report-types";

export const EDIT_FILES = ["s1", "s2", "s3", "cross"];
const SECTION_TABS: (NonProjectSection | "projects")[] = ["projects", "incidents", "operations", "personnel", "technology", "appendix"];

export const tabsOf = (file: string): string[] => (file === "cross" ? ["summary", "decisions"] : SECTION_TABS);

/** Fills a missing file/tab with its default (heads: own section, division: cross); null when the URL names something that does not exist. */
export function resolveEdit(me: { role: string; section: string | null }, file?: string | null, tab?: string | null) {
  file ??= me.role === "Head" && me.section ? me.section : "cross";
  if (!EDIT_FILES.includes(file)) return null;
  tab ??= tabsOf(file)[0];
  return tabsOf(file).includes(tab) ? { file, tab } : null;
}
