import assert from 'node:assert/strict';
import test from 'node:test';
import { ganttDisplayEntries, ganttPosition, ganttRange, ganttTicks, ganttWidth, hasChildTasks, varianceBadgeClass, varianceText } from '../apps/web/src/gantt-model.ts';

const blank = { baselineStart: null, baselineEnd: null, forecastStart: null, forecastEnd: null, actualStart: null, actualEnd: null };
const entries = [
  { ...blank, id: 'p1', kind: 'phase', name: 'P1', state: 'open', baselineStart: '2026-10-01', baselineEnd: '2026-10-11', forecastEnd: '2026-10-13' },
  { ...blank, id: 't1', kind: 'task', name: 'T1', phaseId: 'p1', state: 'open' },
  { ...blank, id: 't2', kind: 'task', name: 'T2', state: 'open' },
  { ...blank, id: 't3', kind: 'task', name: 'T3', phaseId: 'p1', state: 'cancelled' },
  { ...blank, id: 'm1', kind: 'milestone', name: 'M1', state: 'achieved', baselineDate: '2026-10-21', actualDate: '2026-10-21' },
];
const view = (o = {}) => ({ expandTasks: false, showCancelled: false, expandedPhases: new Set(), ...o });
const ids = (v) => ganttDisplayEntries(entries, v).map((e) => e.id);

test('display entries: collapsed, per-phase, expand all, cancelled', () => {
  assert.deepEqual(ids(view()), ['p1', 'm1']);
  assert.deepEqual(ids(view({ expandedPhases: new Set(['p1']) })), ['p1', 't1', 'm1']);
  assert.deepEqual(ids(view({ expandTasks: true })), ['p1', 't1', 't2', 'm1']);
  assert.deepEqual(ids(view({ showCancelled: true })), ['p1', 'm1', 't3']);
});

test('hasChildTasks honours cancelled toggle', () => {
  assert.equal(hasChildTasks(entries, 'p1', false), true);
  assert.equal(hasChildTasks(entries.filter((e) => e.id !== 't1'), 'p1', false), false);
  assert.equal(hasChildTasks(entries.filter((e) => e.id !== 't1'), 'p1', true), true);
});

test('timeline position, width, ticks', () => {
  const range = ganttRange(entries);
  assert.equal(ganttPosition(range, '2026-10-01'), 0);
  assert.equal(ganttPosition(range, '2026-10-21'), 100);
  assert.equal(ganttPosition(range, '2026-10-11'), 50);
  assert.equal(ganttWidth(range, null, null), 2);
  assert.equal(ganttWidth(range, '2026-10-01', '2026-10-11'), 50);
  assert.equal(ganttRange([]), null);
  assert.deepEqual(ganttTicks(null), []);
  assert.deepEqual(ganttTicks(range).map((t) => t.label), ['10/01', '10/06', '10/11', '10/16', '10/21']);
});

test('variance text and badge', () => {
  assert.equal(varianceText(entries[0]), '+2 天');
  assert.equal(varianceBadgeClass(entries[0]), 'variance-delayed');
  assert.equal(varianceText(entries[4]), '如期達成');
  assert.equal(varianceBadgeClass(entries[4]), 'variance-ontime');
  assert.equal(varianceText(entries[1]), '無基準');
  assert.equal(varianceBadgeClass(entries[1]), 'variance-neutral');
});
