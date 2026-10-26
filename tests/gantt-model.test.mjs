import assert from 'node:assert/strict';
import test from 'node:test';
import { ganttDisplayEntries, ganttMarks, ganttPosition, ganttRange, ganttTicks, ganttWidth, ganttLinks, gridRows, hasChildTasks, isPhaseOpen, varianceBadgeClass, varianceText } from '../apps/web/src/gantt-model.ts';

const blank = { planStart: null, planEnd: null, actualStart: null, actualEnd: null };
const entries = [
  { ...blank, id: 'p1', kind: 'phase', name: 'P1', state: 'open', planStart: '2026-10-01', planEnd: '2026-10-11', actualStart: '2026-10-01', actualEnd: '2026-10-13' },
  { ...blank, id: 't1', kind: 'task', name: 'T1', phaseId: 'p1', state: 'open' },
  { ...blank, id: 't2', kind: 'task', name: 'T2', state: 'open' },
  { ...blank, id: 't3', kind: 'task', name: 'T3', phaseId: 'p1', state: 'cancelled' },
  { ...blank, id: 'm1', kind: 'milestone', name: 'M1', state: 'achieved', planDate: '2026-10-21', actualDate: '2026-10-21' },
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

test('variance: actual vs plan (late, early, on time, unfinished)', () => {
  const t = (o) => ({ ...blank, id: 'x', kind: 'task', name: 'X', state: 'open', planEnd: '2026-10-10', ...o });
  assert.equal(varianceText(t({ actualEnd: '2026-10-12' })), '+2 天');
  assert.equal(varianceText(t({ actualEnd: '2026-10-08' })), '-2 天');
  assert.equal(varianceText(t({ actualEnd: '2026-10-10' })), '如期');
  assert.equal(varianceText(t({})), '—');
  const m = (o) => ({ ...blank, id: 'm', kind: 'milestone', name: 'M', state: 'pending', planDate: '2026-10-10', ...o });
  assert.equal(varianceText(m({})), '—');
  assert.equal(varianceText(m({ actualDate: '2026-10-11', state: 'achieved' })), '+1 天');
});

test('marks: plan only, plan + actual, milestone diamonds, no original target', async () => {
  const { ganttTooltip } = await import('../apps/web/src/gantt-model.ts');
  const t = (o) => ({ ...blank, id: 'x', kind: 'task', name: 'X', state: 'open', ...o });
  const planOnly = ganttMarks(t({ planStart: '2026-10-01', planEnd: '2026-10-10' }));
  assert.deepEqual(planOnly.planBar, { start: '2026-10-01', end: '2026-10-10' });
  assert.equal(planOnly.actualBar, null);
  const both = ganttMarks(t({ planStart: '2026-10-01', planEnd: '2026-10-10', actualStart: '2026-10-02', actualEnd: '2026-10-12' }));
  assert.deepEqual(both.actualBar, { start: '2026-10-02', end: '2026-10-12' });
  const running = ganttMarks(t({ planStart: '2026-10-01', planEnd: '2026-10-10', actualStart: '2026-10-02' }), '2026-10-05');
  assert.deepEqual(running.actualBar, { start: '2026-10-02', end: '2026-10-05' });
  const m = (o) => ({ ...blank, id: 'm', kind: 'milestone', name: 'M', state: 'pending', planDate: '2026-10-10', ...o });
  const pending = ganttMarks(m({}));
  assert.deepEqual([pending.planDiamond, pending.actualDiamond, pending.planBar], ['2026-10-10', null, null]);
  const done = ganttMarks(m({ state: 'achieved', actualDate: '2026-10-11' }));
  assert.deepEqual([done.planDiamond, done.actualDiamond], ['2026-10-10', '2026-10-11']);
  assert.deepEqual(Object.keys(done).sort(), ['actualBar', 'actualClass', 'actualDiamond', 'planBar', 'planDiamond']);
  assert.equal(ganttTooltip(m({ state: 'achieved', actualDate: '2026-10-11' })), '計畫：2026-10-10\n實際：2026-10-11\n偏差：+1 天');
  assert.match(ganttTooltip(t({ planStart: '2026-10-01', planEnd: '2026-10-10', actualStart: '2026-10-02' })), /實際：2026-10-02 ~ 進行中\n偏差：—/);
});

test('actual style: late when past plan end, striped while running', () => {
  const today = '2026-10-12';
  const t = (o) => ({ ...blank, id: 'x', kind: 'task', name: 'X', state: 'open', planStart: '2026-10-01', planEnd: '2026-10-10', ...o });
  const cls = (e) => ganttMarks(e, today).actualClass;
  assert.equal(cls(t({ actualStart: '2026-10-02' })), 'late running');
  assert.equal(cls(t({ actualStart: '2026-10-02', planEnd: '2026-10-12' })), 'running');
  assert.equal(cls(t({ actualStart: '2026-10-02', actualEnd: '2026-10-11' })), 'late');
  assert.equal(cls(t({ actualStart: '2026-10-02', actualEnd: '2026-10-10' })), '');
  assert.equal(cls(t({ actualStart: '2026-10-02', planEnd: null })), 'running');
  const m = (o) => ({ ...blank, id: 'm', kind: 'milestone', name: 'M', state: 'achieved', planDate: '2026-10-10', ...o });
  assert.equal(cls(m({ actualDate: '2026-10-11' })), 'late');
  assert.equal(cls(m({ actualDate: '2026-10-10' })), '');
});

test('grid rows: phase, its tasks (cancelled stay), direct tasks, milestones; collapsed phase hides tasks', () => {
  const all = [...entries, { ...blank, id: 'o1', kind: 'task', name: 'orphan', phaseId: 'gone', state: 'open' }];
  const rows = (open) => gridRows(all, (id) => open.includes(id)).map((e) => e.id);
  assert.deepEqual(rows(['p1']), ['p1', 't1', 't3', 't2', 'o1', 'm1']);
  assert.deepEqual(rows([]), ['p1', 't2', 'o1', 'm1']);
});

test('phase open: default decides, a toggle flips it, expand-all wins', () => {
  const v = (o) => ({ expandTasks: false, defaultOpen: false, toggled: new Set(), ...o });
  assert.equal(isPhaseOpen(v(), 'p1'), false);
  assert.equal(isPhaseOpen(v({ toggled: new Set(['p1']) }), 'p1'), true);
  assert.equal(isPhaseOpen(v({ defaultOpen: true }), 'p1'), true);
  assert.equal(isPhaseOpen(v({ defaultOpen: true, toggled: new Set(['p1']) }), 'p1'), false);
  assert.equal(isPhaseOpen(v({ expandTasks: true, defaultOpen: true, toggled: new Set(['p1']) }), 'p1'), true);
});

test('moveTask: reorder, reassign, into phase, direct', async () => {
  const { moveTask } = await import('../apps/web/src/gantt-model.ts');
  const mk = (id, kind, phaseId) => ({ ...blank, id, kind, name: id, state: 'open', ...(kind === 'task' && { phaseId }) });
  const list = [mk('p1', 'phase'), mk('p2', 'phase'), mk('a', 'task', 'p1'), mk('b', 'task', 'p1'), mk('c', 'task', 'p2'), mk('d', 'task', null), mk('m', 'milestone')];
  const run = (id, dest) => moveTask(list, id, dest).map((e) => `${e.id}${e.phaseId ? '@' + e.phaseId : ''}`).join(',');
  assert.equal(run('b', { before: 'a' }), 'p1,p2,b@p1,a@p1,c@p2,d,m');
  assert.equal(run('a', { after: 'b' }), 'p1,p2,b@p1,a@p1,c@p2,d,m');
  assert.equal(run('a', { before: 'c' }), 'p1,p2,b@p1,a@p2,c@p2,d,m');
  assert.equal(run('a', { intoPhase: 'p2' }), 'p1,p2,b@p1,c@p2,a@p2,d,m');
  assert.equal(run('a', { intoPhase: 'p1' }), 'p1,p2,b@p1,a@p1,c@p2,d,m');
  assert.equal(run('a', { direct: true }), 'p1,p2,b@p1,c@p2,d,a,m');
  assert.equal(run('a', { before: 'd' }), 'p1,p2,b@p1,c@p2,a,d,m');
  assert.equal(run('a', { before: 'a' }), 'p1,p2,a@p1,b@p1,c@p2,d,m');
  assert.equal(list[2].phaseId, 'p1', 'input not mutated');
});

test('基準日: same running task is late or not depending on the base date', () => {
  const e = { ...blank, id: 'x', kind: 'task', name: 'X', state: 'in-progress', planStart: '2026-10-01', planEnd: '2026-10-10', actualStart: '2026-10-02' };
  assert.notEqual(ganttMarks(e, '2026-10-09').actualClass, ganttMarks(e, '2026-10-11').actualClass);
  assert.equal(ganttMarks(e, '2026-10-05').actualBar.end, '2026-10-05');
});

test('ganttLinks: endpoints, collapsed reattach, cancelled dropped', () => {
  const e = [
    { ...blank, id: 'p1', kind: 'phase', name: 'P1', state: 'open' },
    { ...blank, id: 't1', kind: 'task', name: 'T1', phaseId: 'p1', state: 'open' },
    { ...blank, id: 't2', kind: 'task', name: 'T2', phaseId: 'p1', state: 'open', predecessors: ['t1'] },
    { ...blank, id: 'p2', kind: 'phase', name: 'P2', state: 'open' },
    { ...blank, id: 't3', kind: 'task', name: 'T3', phaseId: 'p2', state: 'open', predecessors: ['t1', 't2', 'x'] },
    { ...blank, id: 't4', kind: 'task', name: 'T4', phaseId: 'p2', state: 'cancelled', predecessors: ['t1'] },
    { ...blank, id: 'm1', kind: 'milestone', name: 'M', state: 'pending', predecessors: ['t3'] },
  ];
  const view = (expandedPhases) => ganttLinks(e, ganttDisplayEntries(e, { expandTasks: false, showCancelled: false, expandedPhases: new Set(expandedPhases) }));
  assert.deepEqual(view(['p1', 'p2']), [{ from: 't1', to: 't2' }, { from: 't1', to: 't3' }, { from: 't2', to: 't3' }, { from: 't3', to: 'm1' }]);
  // collapsed: t1/t2 -> p1, t3 -> p2; t1->t2 becomes a self link and is dropped; duplicates merge
  assert.deepEqual(view([]), [{ from: 'p1', to: 'p2' }, { from: 'p2', to: 'm1' }]);
});

test('預估完工日: defaults, filled value, phase rollup, none when done or milestone', async () => {
  const { forecastEnds, forecastError } = await import('../apps/web/src/gantt-model.ts');
  const t = (o) => ({ ...blank, kind: 'task', name: 'T', state: 'in-progress', planStart: '2026-10-01', planEnd: '2026-10-10', ...o });
  const all = [
    { ...blank, id: 'p', kind: 'phase', name: 'P', state: 'in-progress', planEnd: '2026-10-10' },
    t({ id: 'a', phaseId: 'p' }),
    t({ id: 'b', phaseId: 'p', forecastEnd: '2026-10-20' }),
    t({ id: 'c', state: 'open', planEnd: '2026-10-05' }),
    t({ id: 'd', state: 'completed', forecastEnd: '2026-10-20' }),
    t({ id: 'e', state: 'open', planEnd: '2026-10-30' }),
    { ...blank, id: 'm', kind: 'milestone', name: 'M', state: 'pending', planDate: '2026-10-01' },
  ];
  const f = forecastEnds(all, '2026-10-12');
  assert.equal(f.get('a'), '2026-10-12', 'overdue unfilled -> base date');
  assert.equal(f.get('b'), '2026-10-20');
  assert.equal(f.get('c'), '2026-10-12');
  assert.equal(f.get('p'), '2026-10-20', 'phase = latest child');
  assert.equal(forecastEnds(all, '2026-10-02').get('a'), '2026-10-10', 'not overdue -> plan end');
  for (const id of ['d', 'e', 'm']) assert.equal(f.has(id), false, id);
  const solo = [{ ...blank, id: 'p', kind: 'phase', name: 'P', state: 'in-progress', planEnd: '2026-10-10' }];
  assert.equal(forecastEnds(solo, '2026-10-12').get('p'), '2026-10-12', 'phase without forecasts uses default');
  assert.match(forecastError(t({ forecastEnd: '2026-09-30' })), /不可早於計畫開始日/);
  assert.match(forecastError(t({ forecastEnd: '2026-10-01', actualStart: '2026-10-03' })), /實際開始日/);
  assert.equal(forecastError(t({ forecastEnd: '2026-10-03' })), null);
  const { varianceText } = await import('../apps/web/src/gantt-model.ts');
  assert.equal(varianceText(t({}), '2026-10-13'), '預估 +3 天');
  assert.equal(varianceText(t({ actualEnd: '2026-10-12' }), '2026-10-13'), '+2 天', 'actual wins');
});

test('cancel clears 預估完工日', async () => {
  const { cancelEntry } = await import('../apps/web/src/schedule-rules.ts');
  const out = cancelEntry([{ ...blank, id: 'a', kind: 'task', name: 'A', state: 'in-progress', forecastEnd: '2026-10-20' }], 'a');
  assert.equal(out[0].forecastEnd, undefined);
});
