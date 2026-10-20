type P = { id: string; kind: "phase" | "task" | "milestone"; state: string; phaseId?: string | null; progress?: number | null };

/** number = percent, null = in progress but not filled, undefined = entry has no progress (milestone / cancelled). */
export type Progress = number | null | undefined;

const mean = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);

/** Child tasks that count toward a phase: cancelled ones are left out. */
export const liveTasksOf = (all: P[], phase: P) => all.filter((t) => t.kind === "task" && t.phaseId === phase.id && t.state !== "cancelled");

/** Own rule: completed 100, open 0, in-progress the filled value. Phases with live child tasks average them instead. */
export function entryProgress(all: P[], e: P): Progress {
  if (e.kind === "milestone" || e.state === "cancelled") return undefined;
  if (e.state === "completed") return 100;
  if (e.kind === "phase") {
    const kids = liveTasksOf(all, e);
    if (kids.length) return mean(kids.map((t) => entryProgress(all, t) ?? 0));
  }
  if (e.state === "open") return 0;
  return e.progress ?? null;
}

export const progressText = (all: P[], e: P) => {
  const p = entryProgress(all, e);
  return p === undefined ? "" : p === null ? "—" : `${p}%`;
};

/** Phases and project-level tasks weigh one unit each; null when there is no unit. */
export function projectProgress(all: P[]): number | null {
  const units = all.filter((e) => e.state !== "cancelled" && (e.kind === "phase" || (e.kind === "task" && !e.phaseId)));
  return units.length ? mean(units.map((e) => entryProgress(all, e) ?? 0)) : null;
}

export const projectProgressText = (all: P[]) => {
  const p = projectProgress(all);
  return p === null ? "—" : `${p}%`;
};

/** Input value to stored progress: integer clamped to 0–100, blank is unfilled. */
export function clampProgress(v: unknown): number | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, Math.round(n))) : undefined;
}
