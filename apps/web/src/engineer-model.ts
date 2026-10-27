import type { EngineerWork } from "./engineer-progress";

/** 某工程師所有層級的 ★ 數與有評語的工作數。 */
export const countMarked = (items: EngineerWork[]): { stars: number; comments: number } =>
  items.reduce(
    (n, w) => {
      const sub = countMarked(w.subItems ?? []);
      return { stars: n.stars + (w.isImportant ? 1 : 0) + sub.stars, comments: n.comments + (w.managerComment ? 1 : 0) + sub.comments };
    },
    { stars: 0, comments: 0 },
  );

/** 「僅看重要」：保留自己重要或含重要後代的工作（連同祖先），回傳新樹，不修改原資料。 */
export const filterImportant = (items: EngineerWork[]): EngineerWork[] =>
  items.flatMap((w) => {
    const subItems = filterImportant(w.subItems ?? []);
    return w.isImportant || subItems.length ? [{ ...w, subItems }] : [];
  });

/** Rows the picker shows: whole tree, or the focused work plus its direct children. onlyImportant trims both to important works (and their important descendants). */
export function pickerList(works: EngineerWork[], focus: EngineerWork[], onlyImportant: boolean): EngineerWork[] {
  const f = focus.at(-1);
  if (!f) return onlyImportant ? filterImportant(works) : works;
  return [f, ...(onlyImportant ? filterImportant(f.subItems ?? []) : f.subItems ?? [])];
}

/** 依編號在整棵樹找原始工作（篩選後的副本需回寫到原資料）。 */
export const findWork = (items: EngineerWork[], workId: number): EngineerWork | undefined => {
  for (const w of items) {
    const hit = w.workId === workId ? w : findWork(w.subItems ?? [], workId);
    if (hit) return hit;
  }
};

/** 工時警示：工作＋休假對標準 40 小時，≤38 不足、≥44 過量，其餘不警示。 */
export const hoursAlert = (work: number, off: number): "short" | "over" | null => {
  const total = work + off;
  return total <= 38 ? "short" : total >= 44 ? "over" : null;
};

/** 主要耗時工作：頂層工作中本週工時最大的前兩項；同時數依彙整檔順序（sort 為穩定排序）。 */
export const topWorks = (items: EngineerWork[]): EngineerWork[] => [...items].sort((a, b) => b.deltaTime - a.deltaTime).slice(0, 2);

/** 課別合計：各人工作時數與休假時數加總。 */
export const sectionTotals = (results: { totalWorkHours?: number; totalOffHours?: number }[]) =>
  results.reduce((n, r) => ({ work: n.work + (r.totalWorkHours ?? 0), off: n.off + (r.totalOffHours ?? 0) }), { work: 0, off: 0 });

/** 顯示姓名：頂層工作優先、再找子工作的第一個非空 ownerName；都沒有時退回帳號。 */
export const displayName = (account: string, items: EngineerWork[]): string =>
  items.find((w) => w.ownerName)?.ownerName ??
  items.map((w) => displayName("", w.subItems ?? [])).find(Boolean) ??
  account;
