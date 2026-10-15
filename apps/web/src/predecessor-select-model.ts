export interface PredecessorOption {
  id: string;
  name: string;
}

export function toggleId(selected: readonly string[] | null | undefined, id: string): string[] {
  const list = selected ?? [];
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

export function selectAllIds(options: readonly PredecessorOption[]): string[] {
  return options.map((o) => o.id);
}

/** Names of selected options (option order), capped at `max`; ids not in `options` are ignored. */
export function summarizeSelection(
  selected: readonly string[] | null | undefined,
  options: readonly PredecessorOption[],
  max = 2
): { names: string[]; extra: number } {
  const picked = new Set(selected ?? []);
  const names = options.filter((o) => picked.has(o.id)).map((o) => o.name || "（未命名）");
  return { names: names.slice(0, max), extra: Math.max(0, names.length - max) };
}
