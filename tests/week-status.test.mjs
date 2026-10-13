import assert from 'node:assert/strict';
import test from 'node:test';
import { weekStatus, publishedDate } from '../apps/web/src/week-status.ts';

const entry = (week, version) => ({ week, version, publishedAt: '2026-10-09T08:00:00Z', publishedBy: 'G', path: '' });

test('week with publications shows its highest version', () => {
  const index = [entry('2026-W41', 1), entry('2026-W41', 2), entry('2026-W40', 1)];
  assert.deepEqual(weekStatus(index, '2026-W41'), { published: true, version: 2, text: '已發布 v2' });
  assert.deepEqual(weekStatus(index, '2026-W40'), { published: true, version: 1, text: '已發布 v1' });
});

test('week without publications is a draft', () => {
  assert.deepEqual(weekStatus([entry('2026-W41', 1)], '2026-W42'), { published: false, version: 0, text: '草稿' });
});

test('publishedDate is month/day', () => {
  assert.equal(publishedDate('2026-10-09T08:00:00Z'), '10/09');
});
