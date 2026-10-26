import assert from 'node:assert/strict';
import test from 'node:test';
import { abortNotice, baselineOf, boundWorkIds, canBind, confirmSync, deltaText, followEngineer, followHint, itemFromWork, missingActualEnd, overrideProgress, pendingCount, previousWeek, revertSync, syncBound } from '../apps/web/src/work-binding.ts';

const work = { workId: 101, workContent: '二層B', status: '處理中', percentage: 30, deltaTime: 1, managerComment: '看一下', subItems: [{ workId: 102, percentage: 99 }] };
const file = (...ids) => ({ items: ids.map((workId) => ({ id: String(workId), section: 'incidents', title: '', content: '', details: {}, workId })).concat([{ id: 'x', section: 'incidents', title: '', content: '', details: {} }]) });

test('workId is unique across files; parent and child bind separately', () => {
  const bound = boundWorkIds([file(100), file(101)]);
  assert.deepEqual([...bound].sort(), [100, 101]);
  assert.equal(canBind(101, bound), false);
  assert.equal(canBind(102, bound), true);
  assert.equal(canBind(100, boundWorkIds([{}, undefined])), true);
});

test('item prefills title from work, content from comment, progress from the work itself', () => {
  const item = itemFromWork(work, 'operations');
  assert.equal(item.title, '二層B');
  assert.equal(item.content, '看一下');
  assert.equal(item.section, 'operations');
  assert.equal(item.workId, 101);
  assert.equal(item.engineerProgress, 30);
  assert.equal(item.engineerStatus, '處理中');
  assert.equal(itemFromWork({ ...work, managerComment: undefined }, 'operations').content, '');
});

test('parent and child each bind once; parent progress ignores children', () => {
  const parent = { ...work, workId: 100, percentage: 40, subItems: [work] };
  const bound = boundWorkIds([{ items: [itemFromWork(parent, 'incidents'), itemFromWork(work, 'operations')] }]);
  assert.equal(canBind(100, bound), false);
  assert.equal(canBind(101, bound), false);
  assert.equal(itemFromWork(parent, 'incidents').engineerProgress, 40);
});

import { missingPlanDates, taskFromWork } from '../apps/web/src/work-binding.ts';

test('project task prefills name, owner and plan dates from the work; dueDate is ignored', () => {
  const w = { ...work, ownerName: '甲', planStartDate: '2026-10-01', planEndDate: '2026-10-20', dueDate: '2026-12-01' };
  const t = taskFromWork(w, 'ph1');
  assert.deepEqual([t.kind, t.name, t.owner, t.phaseId, t.workId, t.planStart, t.planEnd], ['task', '二層B', '甲', 'ph1', 101, '2026-10-01', '2026-10-20']);
  assert.equal(missingPlanDates(t), undefined);
  assert.equal(taskFromWork(w, null).phaseId, null);
});

test('missing plan dates are flagged on bound tasks only', () => {
  const t = taskFromWork({ ...work, planStartDate: '', planEndDate: undefined, dueDate: '2026-12-01' }, 'ph1');
  assert.equal(t.planStart, null);
  assert.equal(t.planEnd, null);
  assert.match(missingPlanDates(t), /計畫起迄/);
  assert.equal(missingPlanDates({ kind: 'task', planStart: null, planEnd: null }), undefined);
});

test('workId uniqueness covers project tasks and section items together', () => {
  const project = { items: [{ id: 'p', section: 'projects', title: '', content: '', details: {}, schedule: [taskFromWork(work, null)] }] };
  const bound = boundWorkIds([project, file(100)]);
  assert.deepEqual([...bound].sort(), [100, 101]);
  assert.equal(canBind(101, bound), false);
});


const bound = () => [{ id: 'i', section: 'operations', title: '', content: '', details: {}, workId: 101, engineerProgress: 10, engineerStatus: '待執行',
  schedule: [{ id: 't', kind: 'task', state: 'in-progress', workId: 102, engineerProgress: 20, progress: 20 }] }];

test('sync pulls percentage into bound items and tasks at any depth; deltaPert is ignored', () => {
  const items = bound();
  const works = [{ workId: 100, percentage: 1, subItems: [{ ...work, percentage: 55, deltaPert: '?' }, { workId: 102, percentage: 70, status: '處理中', deltaPert: -5 }] }];
  assert.equal(syncBound(items, works), 2);
  assert.deepEqual([items[0].engineerProgress, items[0].engineerStatus, items[0].schedule[0].engineerProgress, items[0].schedule[0].progress], [55, '處理中', 70, 70]);
});

test('absent works keep the last snapshot', () => {
  const items = bound();
  assert.equal(syncBound(items, [{ ...work, percentage: 99, absent: true, subItems: [] }]), 0);
  assert.equal(items[0].engineerProgress, 10);
});

test('baseline comes from the published snapshot; new, positive, zero and negative deltas', () => {
  const base = baselineOf([{ items: bound() }, undefined]);
  assert.deepEqual([...base], [[101, 10], [102, 20]]);
  assert.equal(deltaText(101, 35, base), '+25%');
  assert.equal(deltaText(101, 10, base), '+0%');
  assert.equal(deltaText(102, 15, base), '-5%');
  assert.equal(deltaText(103, 5, base), '新增');
  assert.equal(deltaText(undefined, 5, base), '');
  assert.equal(deltaText(103, 5, baselineOf([])), '新增');
});

test('previousWeek crosses year boundaries on ISO weeks', () => {
  assert.equal(previousWeek('2026-W43'), '2026-W42');
  assert.equal(previousWeek('2026-W01'), '2025-W52');
  assert.equal(previousWeek('2021-W01'), '2020-W53');
});


const taskItem = (t = {}) => [{ id: 'p', section: 'projects', title: '', content: '', details: {}, schedule: [{ id: 't', kind: 'task', state: 'open', workId: 7, planStart: null, planEnd: null, actualStart: null, actualEnd: null, ...t }] }];
const upload = (status, percentage) => [{ workId: 7, status, percentage }];

test('status table maps engineer status to task state; 已完成 completes without an actual end', () => {
  for (const [status, state] of [['處理中', 'in-progress'], ['簽核中', 'in-progress'], ['待發佈', 'in-progress'], ['待執行', 'open'], ['已完成', 'completed']]) {
    const items = taskItem({ state: state === 'open' ? 'completed' : 'open' });
    syncBound(items, upload(status, 60));
    assert.equal(items[0].schedule[0].state, state, status);
  }
  const items = taskItem({ state: 'in-progress', progress: 40 });
  syncBound(items, upload('已完成', 100));
  assert.equal(items[0].schedule[0].actualEnd, null);
  assert.equal(missingActualEnd(items[0].schedule[0]), '缺實際結束日');
});

test('中止 only raises a notice and never changes the task', () => {
  const items = taskItem({ state: 'in-progress', progress: 40 });
  syncBound(items, upload('中止', 40));
  const t = items[0].schedule[0];
  assert.deepEqual([t.state, t.pendingSync], ['in-progress', undefined]);
  assert.equal(abortNotice(t), '工程師標示中止');
});

test('badge keeps the first original across uploads; confirm clears it and the count', () => {
  const items = taskItem({ state: 'open' });
  syncBound(items, upload('處理中', 30));
  syncBound(items, upload('處理中', 50));
  const t = items[0].schedule[0];
  assert.deepEqual(t.pendingSync, { state: 'open', progress: undefined, forecastEnd: undefined });
  assert.equal(pendingCount(items), 1);
  confirmSync(t);
  assert.equal(pendingCount(items), 0);
  assert.equal(t.progress, 50);
});

test('revert restores the original and the same upload no longer overwrites; a new one does', () => {
  const items = taskItem({ state: 'in-progress', progress: 20 });
  syncBound(items, upload('已完成', 100));
  const t = items[0].schedule[0];
  revertSync(t);
  assert.deepEqual([t.state, t.progress, t.pendingSync], ['in-progress', 20, undefined]);
  syncBound(items, upload('已完成', 100));
  assert.deepEqual([t.state, t.progress, t.pendingSync], ['in-progress', 20, undefined]);
  syncBound(items, upload('處理中', 80));
  assert.deepEqual([t.state, t.progress], ['in-progress', 80]);
});

test('manual progress pauses sync, shows the engineer latest, and following resumes', () => {
  const items = taskItem({ state: 'in-progress', progress: 20 });
  const t = items[0].schedule[0];
  t.progress = 35;
  overrideProgress(t);
  syncBound(items, upload('處理中', 70));
  assert.deepEqual([t.progress, t.engineerProgress, t.pendingSync], [35, 70, undefined]);
  assert.equal(followHint(t), '工程師最新進度 70%');
  followEngineer(t);
  assert.deepEqual([t.progress, t.progressOverride, followHint(t)], [70, undefined, '']);
  assert.equal(t.pendingSync.progress, 35);
});

test('manual tasks without a workId are never overridden or flagged', () => {
  const t = taskItem({ workId: undefined })[0].schedule[0];
  overrideProgress(t);
  assert.equal(t.progressOverride, undefined);
  assert.equal(missingActualEnd({ ...t, state: 'completed' }), '');
});

test('revert also restores the forecast end that completing cleared', () => {
  const items = taskItem({ state: 'in-progress', progress: 20, forecastEnd: '2026-11-01' });
  syncBound(items, upload('已完成', 100));
  assert.equal(items[0].schedule[0].forecastEnd, undefined);
  revertSync(items[0].schedule[0]);
  assert.equal(items[0].schedule[0].forecastEnd, '2026-11-01');
});
