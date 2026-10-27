import assert from 'node:assert/strict';
import test from 'node:test';
import { countMarked } from '../apps/web/src/engineer-model.ts';

test('countMarked is zero for no works', () => {
  assert.deepEqual(countMarked([]), { stars: 0, comments: 0 });
});

test('countMarked counts stars and comments across three nested levels', () => {
  const items = [
    { workId: 1, isImportant: true, managerComment: '甲', subItems: [
      { workId: 2, managerComment: '乙', subItems: [{ workId: 3, isImportant: true, subItems: [{ workId: 4, managerComment: '丁' }] }] },
    ] },
    { workId: 5 },
  ];
  assert.deepEqual(countMarked(items), { stars: 2, comments: 3 });
});

test('countMarked sees marks that only sub-works carry; empty comment is not a comment', () => {
  const items = [{ workId: 1, managerComment: '', subItems: [{ workId: 2, isImportant: true, managerComment: '子' }] }];
  assert.deepEqual(countMarked(items), { stars: 1, comments: 1 });
});
