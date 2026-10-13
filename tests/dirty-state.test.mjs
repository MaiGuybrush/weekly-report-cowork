import assert from 'node:assert/strict';
import test from 'node:test';
import { isDirty, snapshotOf } from '../apps/web/src/dirty-state.ts';

const file = () => ({ items: [{ id: 'a', section: 'projects', title: '平台', content: '', details: {}, schedule: [{ id: 'e', name: '設計', planEnd: '2026-10-20', actualEnd: null }] }] });

test('untouched draft is clean', () => {
  const saved = snapshotOf(file());
  assert.equal(isDirty(file(), saved), false);
});

test('no snapshot yet (not loaded) is not dirty', () => {
  assert.equal(isDirty(file(), undefined), false);
});

test('editing a nested field is dirty; restoring it is clean again', () => {
  const saved = snapshotOf(file());
  const draft = file();
  draft.items[0].schedule[0].actualEnd = '2026-10-22';
  assert.equal(isDirty(draft, saved), true);
  draft.items[0].schedule[0].actualEnd = null;
  assert.equal(isDirty(draft, saved), false);
});

test('adding then removing an item is clean; removing a saved item is dirty', () => {
  const saved = snapshotOf(file());
  const draft = file();
  draft.items.push({ id: 'b', section: 'incidents', title: '', content: '', details: {} });
  assert.equal(isDirty(draft, saved), true);
  draft.items.pop();
  assert.equal(isDirty(draft, saved), false);
  draft.items.pop();
  assert.equal(isDirty(draft, saved), true);
});

test('typing then clearing a box is not a change ("" equals missing)', () => {
  const saved = snapshotOf(file());
  const draft = file();
  draft.items[0].details.handover = '交接';
  assert.equal(isDirty(draft, saved), true);
  draft.items[0].details.handover = '';
  assert.equal(isDirty(draft, saved), false);
});

test('key order does not matter, array order does', () => {
  const saved = snapshotOf({ list: [{ a: 1, b: 2 }, { a: 3, b: 4 }] });
  assert.equal(isDirty({ list: [{ b: 2, a: 1 }, { b: 4, a: 3 }] }, saved), false);
  assert.equal(isDirty({ list: [{ a: 3, b: 4 }, { a: 1, b: 2 }] }, saved), true);
});

test('a changed text value is dirty', () => {
  const saved = snapshotOf({ managementSummary: '風險', pendingDecisions: [] });
  assert.equal(isDirty({ managementSummary: '風險 ', pendingDecisions: [] }, saved), true);
});
