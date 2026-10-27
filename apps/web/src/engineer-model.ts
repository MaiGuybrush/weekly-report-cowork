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
