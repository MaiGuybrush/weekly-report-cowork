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
