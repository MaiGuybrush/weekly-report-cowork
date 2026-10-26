import assert from 'node:assert/strict';
import test from 'node:test';
import { boundWorkIds, canBind, itemFromWork } from '../apps/web/src/work-binding.ts';

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
