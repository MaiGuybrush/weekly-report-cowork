import type { GanttEntry } from "./gantt-model";

export type ProjectHealth = { status: "ok" | "warn" | "bad"; text: string; progress: string };

/** Summary of one project's schedule; cancelled entries are ignored, milestones don't count toward 完成 x/y. */
export function projectHealth(schedule: Pick<GanttEntry, "kind" | "state" | "planEnd" | "actualEnd" | "planDate" | "actualDate" | "forecastEnd">[], today: string): ProjectHealth {
  const live = schedule.filter((e) => e.state !== "cancelled");
  let late = 0;
  let slipped = 0;
  let forecastLate = 0;
  for (const e of live) {
    const [plan, actual] = e.kind === "milestone" ? [e.planDate, e.actualDate] : [e.planEnd, e.actualEnd];
    if (!plan) continue;
    if (actual) {
      if (actual > plan) slipped++;
    } else if (today > plan) late++;
    else if (e.kind !== "milestone" && e.state !== "completed" && e.forecastEnd && e.forecastEnd > plan) forecastLate++; // 預估延後: not overdue yet
  }
  const tasks = live.filter((e) => e.kind !== "milestone");
  const done = tasks.filter((e) => e.state === "completed").length;
  const progress = `完成 ${done}/${tasks.length}`;
  if (late) return { status: "bad", text: `逾期 ${late} 項`, progress };
  if (forecastLate) return { status: "warn", text: `預估延後 ${forecastLate} 項`, progress };
  if (slipped) return { status: "warn", text: `曾延後 ${slipped} 項`, progress };
  return { status: "ok", text: "依計畫", progress };
}
