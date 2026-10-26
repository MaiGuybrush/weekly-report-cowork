import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEdit, tabsOf } from '../apps/web/src/edit-nav.ts';

const head = { role: 'Head', section: 's2' };
const division = { role: 'Division', section: null };

test('missing file defaults to own section for heads and cross for division', () => {
  assert.deepEqual(resolveEdit(head), { file: 's2', tab: 'projects' });
  assert.deepEqual(resolveEdit(division), { file: 'cross', tab: 'summary' });
});

test('missing tab defaults to the first tab of the file', () => {
  assert.deepEqual(resolveEdit(head, 's1'), { file: 's1', tab: 'projects' });
  assert.deepEqual(resolveEdit(head, 'cross'), { file: 'cross', tab: 'summary' });
});

test('valid deep link is kept', () => {
  assert.deepEqual(resolveEdit(division, 's3', 'personnel'), { file: 's3', tab: 'personnel' });
  assert.deepEqual(resolveEdit(head, 'cross', 'decisions'), { file: 'cross', tab: 'decisions' });
});

test('unknown file or tab (or tab of another file) is rejected', () => {
  assert.equal(resolveEdit(head, 's9'), null);
  assert.equal(resolveEdit(head, 's1', 'nope'), null);
  assert.equal(resolveEdit(head, 's1', 'summary'), null);
  assert.equal(resolveEdit(head, 'cross', 'projects'), null);
});

test('section files have projects, every section tab and the engineer progress page', () => {
  assert.deepEqual(tabsOf('s1'), ['projects', 'incidents', 'operations', 'personnel', 'technology', 'appendix', 'engineer']);
});
