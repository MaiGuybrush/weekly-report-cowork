import assert from 'node:assert/strict';
import test from 'node:test';
import { clampProgress, entryProgress, progressText, projectProgress } from '../apps/web/src/project-progress.ts';

const e = (o) => ({ id: 'x', kind: 'task', name: 'X', state: 'open', phaseId: null, ...o });
const phase = (id, o) => e({ id, kind: 'phase', ...o });
const task = (id, phaseId, o) => e({ id, phaseId, ...o });

test('single entry: completed 100, open 0, in-progress uses filled value', () => {
  assert.equal(entryProgress([e({ state: 'completed' })], e({ state: 'completed', progress: 10 })), 100);
  assert.equal(entryProgress([], e({ state: 'open', progress: 40 })), 0);
  assert.equal(entryProgress([], e({ state: 'in-progress', progress: 40 })), 40);
});

test('in-progress without value is unfilled (null); text shows 「—」', () => {
  const x = e({ state: 'in-progress' });
  assert.equal(entryProgress([], x), null);
  assert.equal(progressText([], x), '—');
  assert.equal(progressText([], e({ state: 'in-progress', progress: 0 })), '0%');
});

test('cancelled and milestone have no progress', () => {
  assert.equal(entryProgress([], e({ state: 'cancelled' })), undefined);
  assert.equal(progressText([], e({ state: 'cancelled' })), '');
  assert.equal(entryProgress([], e({ kind: 'milestone', state: 'pending' })), undefined);
});

test('phase with children: equal-weight rounded mean, cancelled excluded, unfilled counts 0', () => {
  const p = phase('p', { state: 'in-progress', progress: 90 });
  const all = [p, task('a', 'p', { state: 'completed' }), task('b', 'p', { state: 'in-progress', progress: 50 }), task('c', 'p', { state: 'in-progress' }), task('d', 'p', { state: 'cancelled' })];
  assert.equal(entryProgress(all, p), 50);
  assert.equal(entryProgress([p, task('a', 'p', { state: 'completed' }), task('b', 'p', { state: 'open' }), task('c', 'p', { state: 'open' })], p), 33);
});

test('phase without live children uses own rule; completed phase is always 100', () => {
  const p = phase('p', { state: 'in-progress', progress: 30 });
  assert.equal(entryProgress([p, task('d', 'p', { state: 'cancelled' })], p), 30);
  const done = phase('p', { state: 'completed' });
  assert.equal(entryProgress([done, task('a', 'p', { state: 'open' })], done), 100);
});

test('project overall: phases + direct tasks one unit each; tasks under phase and milestones skipped', () => {
  const p = phase('p', { state: 'in-progress' });
  const all = [p, task('a', 'p', { state: 'completed' }), task('b', 'p', { state: 'open' }), task('direct', null, { state: 'completed' }), e({ kind: 'milestone', state: 'achieved' }), task('x', null, { state: 'cancelled' })];
  assert.equal(projectProgress(all), 75);
});

test('project overall: no units shows 「—」 (null)', () => {
  assert.equal(projectProgress([]), null);
  assert.equal(projectProgress([e({ kind: 'milestone', state: 'pending' })]), null);
});

test('clamp: 0–100 integer, blank is unfilled', () => {
  assert.equal(clampProgress(150), 100);
  assert.equal(clampProgress(-5), 0);
  assert.equal(clampProgress(33.6), 34);
  assert.equal(clampProgress(null), undefined);
  assert.equal(clampProgress(''), undefined);
  assert.equal(clampProgress(NaN), undefined);
});
