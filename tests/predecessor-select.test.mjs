import assert from 'node:assert/strict';
import test from 'node:test';
import { toggleId, selectAllIds, summarizeSelection } from '../apps/web/src/predecessor-select-model.ts';

const options = [
  { id: 'a', name: '設計' },
  { id: 'b', name: '規格' },
  { id: 'c', name: '開發' },
  { id: 'd', name: '測試' },
];

test('toggleId adds then removes, never mutates input', () => {
  const start = ['a'];
  assert.deepEqual(toggleId(start, 'b'), ['a', 'b']);
  assert.deepEqual(toggleId(['a', 'b'], 'a'), ['b']);
  assert.deepEqual(start, ['a']);
  assert.deepEqual(toggleId(null, 'a'), ['a']);
});

test('selectAllIds returns every option id', () => {
  assert.deepEqual(selectAllIds(options), ['a', 'b', 'c', 'd']);
  assert.deepEqual(selectAllIds([]), []);
});

test('summarizeSelection: names in option order, capped, with overflow count', () => {
  assert.deepEqual(summarizeSelection(['c', 'a'], options, 2), { names: ['設計', '開發'], extra: 0 });
  assert.deepEqual(summarizeSelection(['a', 'b', 'c', 'd'], options, 2), { names: ['設計', '規格'], extra: 2 });
  assert.deepEqual(summarizeSelection([], options), { names: [], extra: 0 });
  assert.deepEqual(summarizeSelection(null, options), { names: [], extra: 0 });
});

test('summarizeSelection: ids missing from options are ignored', () => {
  assert.deepEqual(summarizeSelection(['zzz', 'b'], options), { names: ['規格'], extra: 0 });
});

test('summarizeSelection: blank names fall back to placeholder', () => {
  assert.deepEqual(summarizeSelection(['x'], [{ id: 'x', name: '' }]), { names: ['（未命名）'], extra: 0 });
});
