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

/** 依編號在整棵樹找原始工作（篩選後的副本需回寫到原資料）。 */
export const findWork = (items: EngineerWork[], workId: number): EngineerWork | undefined => {
  for (const w of items) {
    const hit = w.workId === workId ? w : findWork(w.subItems ?? [], workId);
    if (hit) return hit;
  }
};
