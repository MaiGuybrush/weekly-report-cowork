import type { GanttEntry } from "./gantt-model";

// Schedule rules for ONE project, ported from the legacy backend (ScheduleEntries / dependency endpoints).
// JSON stores only `predecessors` (entry ids); everything else here is derived.

export type DependencyWarning = { type: "active-warning" | "conflict"; message: string; predecessorId: string; predecessorName: string };
export type ExternalDelivery = { id: string; description: string; supplier: string; dueDate: string; status: string; entryIds: string[] };
export type ExternalDeliveryNotice = { dependencyId: string; description: string; supplier: string; dueDate: string; status: string; isOverdue: boolean; message: string };

export type ScheduleInput = Omit<GanttEntry, "warnings" | "externalNotices"> & { predecessors?: string[] };
export type ScheduleOutput = ScheduleInput & { predecessors: string[]; successors: string[]; warnings: DependencyWarning[]; externalNotices: ExternalDeliveryNotice[] };
export type ScheduleError = { entryId: string; predecessorId: string; message: string };

const isMilestone = (e: ScheduleInput) => e.kind === "milestone";

export function evaluateSchedule(entries: ScheduleInput[], deliveries: ExternalDelivery[] = [], today = new Date().toISOString().slice(0, 10)) {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const errors: ScheduleError[] = [];
  const accepted = new Map<string, string[]>(); // predecessor -> successors, valid links only
  const preds = new Map<string, string[]>();

  const reaches = (from: string, target: string) => {
    const seen = new Set([from]);
    const queue = [from];
    for (let cur = queue.shift(); cur !== undefined; cur = queue.shift()) {
      if (cur === target) return true;
      for (const n of accepted.get(cur) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
    }
    return false;
  };

  const reject = (s: ScheduleInput, pId: string, message: string) => errors.push({ entryId: s.id, predecessorId: pId, message });

  for (const s of entries) {
    for (const pId of s.predecessors ?? []) {
      const p = byId.get(pId);
      if (pId === s.id) reject(s, pId, "self dependency not allowed");
      else if (!p) reject(s, pId, "cross project or non-existent dependency");
      else if (p.state === "cancelled" || s.state === "cancelled") reject(s, pId, "cannot link cancelled schedule entry");
      else if ((p.kind === "phase" && s.kind === "task" && s.phaseId === p.id) || (s.kind === "phase" && p.kind === "task" && p.phaseId === s.id)) reject(s, pId, "phase and direct subtask cannot be linked");
      else if (preds.get(s.id)?.includes(pId)) reject(s, pId, "dependency already exists");
      else if (reaches(s.id, pId)) reject(s, pId, "dependency cycle detected");
      else {
        accepted.set(pId, [...(accepted.get(pId) ?? []), s.id]);
        preds.set(s.id, [...(preds.get(s.id) ?? []), pId]);
      }
    }
  }

  const warnings = new Map<string, DependencyWarning[]>();
  for (const [sId, pIds] of preds) {
    const s = byId.get(sId)!;
    for (const pId of pIds) {
      const p = byId.get(pId)!;
      const list = warnings.get(sId) ?? [];
      warnings.set(sId, list);

      const pFinish = isMilestone(p) ? (p.actualDate ?? p.forecastDate ?? p.baselineDate) : (p.actualEnd ?? p.forecastEnd ?? p.baselineEnd);
      const pActual = isMilestone(p) ? p.actualDate : p.actualEnd;
      const pCompleted = isMilestone(p) ? (p.actualDate != null || p.state === "achieved") : (p.actualEnd != null || p.state === "completed");
      const sStart = isMilestone(s) ? (s.actualDate ?? s.forecastDate ?? s.baselineDate) : (s.actualStart ?? s.forecastStart ?? s.baselineStart);
      const sActual = isMilestone(s) ? s.actualDate : s.actualStart;
      const sStarted = isMilestone(s) ? (s.actualDate != null || s.state === "achieved") : (s.actualStart != null || s.state === "in-progress" || s.state === "completed");

      if (sStarted && !pCompleted)
        list.push({ type: "active-warning", message: `即時警示：前置項目「${p.name}」尚未完成，後續項目已搶先開始`, predecessorId: p.id, predecessorName: p.name });

      if (pFinish && sStart && pFinish > sStart) {
        const historical = sActual != null || (pActual != null && sStarted);
        const message = historical
          ? `順序衝突（歷史搶先開始）：前置項目「${p.name}」完成日 (${pFinish}) 晚於本項開始日 (${sStart})`
          : `順序衝突：前置項目「${p.name}」預計完成日 (${pFinish}) 晚於本項預計開始日 (${sStart})`;
        list.push({ type: "conflict", message, predecessorId: p.id, predecessorName: p.name });
      }
    }
  }

  const notices = new Map<string, ExternalDeliveryNotice[]>();
  for (const d of deliveries) {
    if (d.status === "delivered") continue;
    const isOverdue = d.dueDate < today;
    const message = isOverdue
      ? `外部交付提醒（已逾期）：由「${d.supplier}」承諾之「${d.description}」已逾期（到期日：${d.dueDate}）`
      : `外部交付提醒：由「${d.supplier}」承諾之「${d.description}」尚未交付（預計到期日：${d.dueDate}）`;
    for (const entryId of d.entryIds) {
      if (byId.get(entryId)?.state === "cancelled") continue;
      notices.set(entryId, [...(notices.get(entryId) ?? []), { dependencyId: d.id, description: d.description, supplier: d.supplier, dueDate: d.dueDate, status: d.status, isOverdue, message }]);
    }
  }

  const output: ScheduleOutput[] = entries.map((e) => ({
    ...e,
    predecessors: preds.get(e.id) ?? [],
    successors: accepted.get(e.id) ?? [],
    warnings: warnings.get(e.id) ?? [],
    externalNotices: notices.get(e.id) ?? [],
  }));
  return { entries: output, errors };
}

// Cancel keeps the entry (state "cancelled") but drops phase membership and every dependency touching it.
export function cancelEntry<T extends ScheduleInput>(entries: T[], id: string): T[] {
  return entries.map((e) => {
    if (e.id === id) return { ...e, state: "cancelled" as const, phaseId: null, predecessors: [] };
    const next = { ...e, predecessors: e.predecessors?.filter((p) => p !== id) };
    return e.phaseId === id ? { ...next, phaseId: null } : next;
  });
}

// Reactivate restores the pre-cancel state, which is derivable: started -> in-progress, else open (milestone: pending).
export function reactivateEntry<T extends ScheduleInput>(entries: T[], id: string): T[] {
  return entries.map((e) =>
    e.id !== id || e.state !== "cancelled" ? e : { ...e, state: isMilestone(e) ? "pending" : e.actualStart ? "in-progress" : "open" },
  );
}
