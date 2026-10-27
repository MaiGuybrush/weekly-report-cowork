import assert from 'node:assert/strict';
import test from 'node:test';
import { chaptersOf, systemGroupsOf } from '../apps/web/src/report-chapters.ts';

const item = (id, section) => ({ id, section, title: id, content: '', details: {} });
const ids = (c) => c.items.map((i) => i.id);

test('chapters follow official order and name, merging the three files', () => {
  const s1 = { items: [item('s1-tech', 'technology'), item('s1-p', 'projects'), item('s1-inc', 'incidents')] };
  const s2 = { items: [item('s2-op', 'operations'), item('s2-p', 'projects'), item('s2-hr', 'personnel')] };
  const s3 = { items: [item('s3-p', 'projects'), item('s3-inc', 'incidents')] };
  const chapters = chaptersOf([s1, s2, s3]);
  assert.deepEqual(chapters.map((c) => c.section), ['projects', 'incidents', 'operations', 'personnel', 'technology']);
  assert.deepEqual(ids(chapters[0]), ['s1-p', 's2-p', 's3-p']);
  assert.deepEqual(ids(chapters[1]), ['s1-inc', 's3-inc']);
});

test('empty chapters are omitted and missing files are tolerated', () => {
  const chapters = chaptersOf([undefined, { items: [item('a', 'operations')] }, {}]);
  assert.deepEqual(chapters.map((c) => c.section), ['operations']);
  assert.deepEqual(chaptersOf([undefined, undefined, undefined]), []);
});

const op = (id, system) => ({ ...item(id, 'operations'), ...(system === undefined ? {} : { system }) });

test('maintenance groups merge across files, ordered by first appearance, 未分類 last', () => {
  const items = [op('a', undefined), op('b', 'MES'), op('c', 'EAP'), op('d', ' MES '), op('e', '  '), op('f', 'mes')];
  const groups = systemGroupsOf(items);
  assert.deepEqual(groups.map((g) => g.system), ['MES', 'EAP', 'mes', null]);
  assert.deepEqual(groups.map(ids), [['b', 'd'], ['c'], ['f'], ['a', 'e']]);
});

test('no unclassified group when every item has a system; empty input gives no groups', () => {
  assert.deepEqual(systemGroupsOf([op('a', 'X')]).map((g) => g.system), ['X']);
  assert.deepEqual(systemGroupsOf([]), []);
});
