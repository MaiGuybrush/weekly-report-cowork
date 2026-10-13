import type { PublicationIndex } from "./report-types";

export type WeekStatus = { published: boolean; version: number; text: string };

/** Derived only from the publication index: highest published version of the week, else draft. */
export function weekStatus(entries: PublicationIndex["publications"], week: string): WeekStatus {
  const version = Math.max(0, ...entries.filter((e) => e.week === week).map((e) => e.version));
  return version ? { published: true, version, text: `已發布 v${version}` } : { published: false, version: 0, text: "草稿" };
}

export const publishedDate = (publishedAt: string) => publishedAt.slice(5, 10).replace("-", "/");
