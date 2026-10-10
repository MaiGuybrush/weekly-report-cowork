import assert from 'node:assert/strict';
import test from 'node:test';
import { cancelEntry, evaluateSchedule, reactivateEntry } from '../apps/web/src/schedule-rules.ts';

const blank = { baselineStart: null, baselineEnd: null, forecastStart: null, forecastEnd: null, actualStart: null, actualEnd: null };
const e = (id, o = {}) => ({ ...blank, id, kind: 'task', name: id.toUpperCase(), state: 'open', predecessors: [], ...o });
const errs = (entries) => evaluateSchedule(entries).errors.map((x) => `${x.entryId}<-${x.predecessorId}:${x.message}`);

test('rejects cycles, cross-project, phase/direct child, self, duplicate, cancelled', () => {
  assert.deepEqual(errs([e('a', { predecessors: ['b'] }), e('b', { predecessors: ['a'] })]), ['b<-a:dependency cycle detected']);
  assert.deepEqual(errs([e('a', { predecessors: ['x'] })]), ['a<-x:cross project or non-existent dependency']);
  assert.deepEqual(errs([e('p', { kind: 'phase' }), e('t', { phaseId: 'p', predecessors: ['p'] })]), ['t<-p:phase and direct subtask cannot be linked']);
  assert.deepEqual(errs([e('p', { kind: 'phase', predecessors: ['t'] }), e('t', { phaseId: 'p' })]), ['p<-t:phase and direct subtask cannot be linked']);
  assert.deepEqual(errs([e('a', { predecessors: ['a'] })]), ['a<-a:self dependency not allowed']);
  assert.deepEqual(errs([e('a'), e('b', { predecessors: ['a', 'a'] })]), ['b<-a:dependency already exists']);
  assert.deepEqual(errs([e('a', { state: 'cancelled' }), e('b', { predecessors: ['a'] })]), ['b<-a:cannot link cancelled schedule entry']);
  assert.deepEqual(errs([e('a'), e('b', { predecessors: ['a'] }), e('c', { predecessors: ['b'] })]), []);
});

test('derives successors; invalid links are not derived', () => {
  const { entries } = evaluateSchedule([e('a'), e('b', { predecessors: ['a'] }), e('c', { predecessors: ['a', 'zzz'] })]);
  assert.deepEqual(entries[0].successors, ['b', 'c']);
  assert.deepEqual(entries[2].predecessors, ['a']);
});

test('order conflict (planned and historical) and live warning', () => {
  const planned = evaluateSchedule([e('a', { forecastEnd: '2026-10-10' }), e('b', { predecessors: ['a'], forecastStart: '2026-10-05' })]).entries[1].warnings;
  assert.equal(planned[0].type, 'conflict');
  assert.equal(planned[0].message, '順序衝突：前置項目「A」預計完成日 (2026-10-10) 晚於本項預計開始日 (2026-10-05)');

  const live = evaluateSchedule([e('a'), e('b', { predecessors: ['a'], state: 'in-progress', actualStart: '2026-10-01' })]).entries[1].warnings;
  assert.deepEqual(live.map((w) => w.type), ['active-warning']);
  assert.equal(live[0].message, '即時警示：前置項目「A」尚未完成，後續項目已搶先開始');

  const hist = evaluateSchedule([e('a', { actualEnd: '2026-10-10', state: 'completed' }), e('b', { predecessors: ['a'], actualStart: '2026-10-05', state: 'in-progress' })]).entries[1].warnings;
  assert.equal(hist[0].message, '順序衝突（歷史搶先開始）：前置項目「A」完成日 (2026-10-10) 晚於本項開始日 (2026-10-05)');

  const ok = evaluateSchedule([e('a', { forecastEnd: '2026-10-01' }), e('b', { predecessors: ['a'], forecastStart: '2026-10-05' })]).entries[1].warnings;
  assert.deepEqual(ok, []);
});

test('external delivery notices: overdue, pending, delivered, cancelled', () => {
  const d = (o) => ({ id: 'd1', description: '載具', supplier: '採購部', dueDate: '2026-10-01', status: 'pending', entryIds: ['a'], ...o });
  const run = (deliveries, entries = [e('a')]) => evaluateSchedule(entries, deliveries, '2026-10-10').entries[0].externalNotices;
  const overdue = run([d({})]);
  assert.equal(overdue[0].isOverdue, true);
  assert.equal(overdue[0].message, '外部交付提醒（已逾期）：由「採購部」承諾之「載具」已逾期（到期日：2026-10-01）');
  const upcoming = run([d({ dueDate: '2026-10-20' })]);
  assert.equal(upcoming[0].isOverdue, false);
  assert.equal(upcoming[0].message, '外部交付提醒：由「採購部」承諾之「載具」尚未交付（預計到期日：2026-10-20）');
  assert.deepEqual(run([d({ status: 'delivered' })]), []);
  assert.deepEqual(run([d({})], [e('a', { state: 'cancelled' })]), []);
});

test('cancel drops membership and dependencies; reactivate restores original state', () => {
  const start = [
    e('p', { kind: 'phase' }),
    e('t', { phaseId: 'p', state: 'in-progress', actualStart: '2026-10-01', predecessors: ['x'] }),
    e('x'),
    e('y', { predecessors: ['t'] }),
    e('m', { kind: 'milestone', state: 'pending' }),
  ];
  const cancelled = cancelEntry(start, 't');
  const t = cancelled.find((x) => x.id === 't');
  assert.deepEqual([t.state, t.phaseId, t.predecessors], ['cancelled', null, []]);
  assert.deepEqual(cancelled.find((x) => x.id === 'y').predecessors, []);
  assert.equal(reactivateEntry(cancelled, 't').find((x) => x.id === 't').state, 'in-progress');
  assert.equal(reactivateEntry(cancelEntry(start, 'x'), 'x').find((x) => x.id === 'x').state, 'open');
  assert.equal(reactivateEntry(cancelEntry(start, 'm'), 'm').find((x) => x.id === 'm').state, 'pending');
  assert.equal(cancelEntry(start, 'p').find((x) => x.id === 't').phaseId, null);
});
