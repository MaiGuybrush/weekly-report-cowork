/** Key-order and empty-value insensitive: "" / null equal a missing field, so typing then clearing a box is not a change. */
const canonical = (_key: string, value: unknown) =>
  value === "" || value === null
    ? undefined
    : value && typeof value === "object" && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
      : value;

/** What a file looked like when last loaded or saved. */
export const snapshotOf = (draft: unknown) => JSON.stringify(draft, canonical);

/** A file is dirty when its draft differs from the saved snapshot. */
export const isDirty = (draft: unknown, snapshot: string | undefined) => snapshot !== undefined && snapshotOf(draft) !== snapshot;
