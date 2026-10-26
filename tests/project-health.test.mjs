import assert from 'node:assert/strict';
import test from 'node:test';
import { projectHealth } from '../apps/web/src/project-health.ts';

const TODAY = '2026-10-12';
const blank = { planStart: null, planEnd: null, actualStart: null, actualEnd: null };
const task = (o) => ({ ...blank, id: 'x', kind: 'task', name: 'X', state: 'open', ...o });
const milestone = (o) => ({ id: 'm', kind: 'milestone', name: 'M', state: 'pending', planDate: null, actualDate: null, ...o });
const health = (schedule) => projectHealth(schedule, TODAY);

test('on plan: nothing late or slipped', () => {
  const h = health([task({ planEnd: '2026-10-20' }), task({ state: 'completed', planEnd: '2026-10-10', actualEnd: '2026-10-10' })]);
  assert.deepEqual([h.status, h.text, h.progress], ['ok', '依計畫', '完成 1/2']);
});

test('no schedule: on plan, 0/0', () => {
  const h = health([]);
  assert.deepEqual([h.status, h.text, h.progress], ['ok', '依計畫', '完成 0/0']);
});

test('overdue: unfinished past plan end, incl. milestone past plan date', () => {
  const h = health([task({ planEnd: '2026-10-11' }), milestone({ planDate: '2026-10-01' }), task({ planEnd: '2026-10-12' })]);
  assert.deepEqual([h.status, h.text], ['bad', '逾期 2 項']);
});

test('slipped: finished after plan end, no overdue left', () => {
  const h = health([task({ state: 'completed', planEnd: '2026-10-05', actualEnd: '2026-10-08' }), milestone({ state: 'achieved', planDate: '2026-10-05', actualDate: '2026-10-06' })]);
  assert.deepEqual([h.status, h.text], ['warn', '曾延後 2 項']);
});

test('overdue wins over slipped', () => {
  const h = health([task({ planEnd: '2026-10-01' }), task({ state: 'completed', planEnd: '2026-10-05', actualEnd: '2026-10-08' })]);
  assert.deepEqual([h.status, h.text], ['bad', '逾期 1 項']);
});

test('cancelled entries are ignored; milestones do not count toward x/y', () => {
  const h = health([
    task({ state: 'cancelled', planEnd: '2026-10-01' }),
    task({ state: 'completed', planEnd: '2026-10-10', actualEnd: '2026-10-10' }),
    milestone({ state: 'achieved', planDate: '2026-10-10', actualDate: '2026-10-10' }),
  ]);
  assert.deepEqual([h.status, h.text, h.progress], ['ok', '依計畫', '完成 1/1']);
});

test('late start alone is not a slip', () => {
  const h = health([task({ state: 'in-progress', planStart: '2026-10-01', planEnd: '2026-10-20', actualStart: '2026-10-05' })]);
  assert.equal(h.text, '依計畫');
});

test('基準日: same data, different base date, different overdue and health', () => {
  const s = [task({ planEnd: '2026-10-20' })];
  assert.equal(projectHealth(s, '2026-10-20').text, '依計畫');
  assert.deepEqual([projectHealth(s, '2026-10-21').status, projectHealth(s, '2026-10-21').text], ['bad', '逾期 1 項']);
});

test('預估延後: not overdue, forecast past plan end; ranks below overdue, above slipped', () => {
  const f = task({ state: 'in-progress', planEnd: '2026-10-20', forecastEnd: '2026-10-25' });
  const slip = task({ state: 'completed', planEnd: '2026-10-05', actualEnd: '2026-10-08' });
  assert.deepEqual([health([f]).status, health([f]).text], ['warn', '預估延後 1 項']);
  assert.equal(health([f, slip]).text, '預估延後 1 項');
  assert.equal(health([f, task({ planEnd: '2026-10-01' })]).text, '逾期 1 項');
});

test('預估延後: overdue not double counted; done, cancelled, forecast on/before plan ignored', () => {
  const h = health([
    task({ planEnd: '2026-10-01', forecastEnd: '2026-10-30' }),
    task({ state: 'completed', planEnd: '2026-10-20', forecastEnd: '2026-10-25' }),
    task({ state: 'cancelled', planEnd: '2026-10-20', forecastEnd: '2026-10-25' }),
    task({ planEnd: '2026-10-20', forecastEnd: '2026-10-20' }),
    task({ planEnd: '2026-10-20', forecastEnd: '2026-10-15' }),
  ]);
  assert.equal(h.text, '逾期 1 項');
  assert.equal(health([task({ planEnd: '2026-10-20', forecastEnd: '2026-10-20' })]).text, '依計畫');
});
