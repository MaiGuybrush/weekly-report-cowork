import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const temporary = mkdtempSync(join(tmpdir(), 'weeks-smoke-'));
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
const remote = join(temporary, 'remote.git');
const seed = join(temporary, 'seed');
const work = join(temporary, 'work');
git(temporary, 'init', '--bare', remote);
cpSync(join(root, 'tests/fixtures/data-repo'), seed, { recursive: true });
git(seed, 'init');
git(seed, 'add', '.');
git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'seed');
git(seed, 'push', remote, 'HEAD:refs/heads/master');
git(temporary, 'clone', remote, work);

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwks = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [{ ...publicKey.export({ format: 'jwk' }), alg: 'RS256' }] })); });
await new Promise(r => jwks.listen(0, '127.0.0.1', r));
const port = await new Promise(r => { const s = createTcpServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const api = spawn('dotnet', [process.env.WEEKLY_REPORT_API_DLL ?? join(root, 'apps/api/bin/Debug/net9.0/WeeklyReport.Api.dll'), '--urls', `http://127.0.0.1:${port}`], {
  cwd: join(root, 'apps/api'),
  env: { ...process.env, JwksUrl: `http://127.0.0.1:${jwks.address().port}/jwks`,
    DataRepo__Path: work, DataRepo__Remote: remote, EngineerWork__Path: join(root, 'tests/fixtures/engineer-work'),
    Access__Users__0__EmpNo: 'G', Access__Users__0__Name: 'Division', Access__Users__0__Role: 'Division',
    Access__Users__1__EmpNo: 'H1', Access__Users__1__Name: 'Head One', Access__Users__1__Role: 'Head', Access__Users__1__Section: 's1',
    Access__Users__2__EmpNo: 'H2', Access__Users__2__Name: 'Head Two', Access__Users__2__Role: 'Head', Access__Users__2__Section: 's2' }
});
let logs = '';
api.stdout.on('data', c => logs = (logs + c).slice(-10000));
api.stderr.on('data', c => logs = (logs + c).slice(-10000));
const base = `http://127.0.0.1:${port}`;
const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
const token = empNo => { const p = `${b64({ alg: 'RS256' })}.${b64({ empNo, exp: Math.floor(Date.now() / 1000) + 3600 })}`; return `${p}.${sign('RSA-SHA256', Buffer.from(p), privateKey).toString('base64url')}`; };
const intake = name => readFileSync(join(root, 'tests/fixtures/engineer-intake', name), 'utf8');
async function upload(user, name, text = intake(name)) {
  const response = await fetch(`${base}/api/engineer-work?filename=${encodeURIComponent(name)}`, { method: 'POST', headers: { Authorization: `Bearer ${token(user)}` }, body: text });
  const t = await response.text();
  return { status: response.status, body: t ? JSON.parse(t) : null };
}
async function call(path, user, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token(user)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
try {
  for (let i = 0; i < 100; i++) { try { await fetch(base); break; } catch { await new Promise(r => setTimeout(r, 100)); } }

  const first = await call('/api/weeks', 'H1'); assert.deepEqual(first.body, ['2026-W41'], 'status ' + first.status);
  const week = (await call('/api/weeks/2026-W41', 'H1')).body;
  assert.equal(week.s1.items.length, 2);
  assert.equal(week.cross.managementSummary, '本週無重大風險。');
  assert.deepEqual((await call('/api/weeks/2026-W42', 'H1')).body, { s1: {}, s2: {}, s3: {}, cross: {} });

  const edited = { ...week.s1, items: [...week.s1.items, { id: 'new', section: 'technology', title: '新技術', content: '評估中', details: {} }] };
  assert.equal((await call('/api/weeks/2026-W41/s1', 'H1', 'PUT', edited)).status, 204);
  assert.equal((await call('/api/weeks/2026-W41', 'H1')).body.s1.items.length, 3);
  const remoteLog = git(remote, 'log', '--format=%s', 'master');
  assert.match(remoteLog, /2026-W41\/s1: update by H1/);

  assert.equal((await call('/api/weeks/2026-W41/s2', 'H1', 'PUT', week.s2)).status, 403);
  assert.equal((await call('/api/weeks/2026-W41/cross', 'H1', 'PUT', week.cross)).status, 403);
  assert.equal((await call('/api/weeks/2026-W41/s1', 'G', 'PUT', week.s1)).status, 403);
  assert.equal((await call('/api/weeks/2026-W41/cross', 'G', 'PUT', week.cross)).status, 204);

  assert.equal((await call('/api/weeks/2026-41/s1', 'H1', 'PUT', edited)).status, 400);
  assert.equal((await call('/api/weeks/2026-W41/s9', 'H1', 'PUT', edited)).status, 400);
  assert.equal((await call('/api/weeks/2026-W41/s1', 'H1', 'PUT', { ...edited, week: '2026-W40' })).status, 400);
  assert.equal((await call('/api/weeks/2026-W41/s1', 'H1', 'PUT', { ...edited, section: 's2' })).status, 400);
  assert.equal((await call('/api/weeks/2026-W41/s1', 'H1', 'PUT', [1])).status, 400);
  // remote advanced by someone else: next write rebases and still pushes
  git(seed, 'pull', remote, 'master');
  writeFileSync(join(seed, 'weeks/2026-W41/s3.json'), JSON.stringify({ week: '2026-W41', section: 's3', items: [] }));
  git(seed, 'add', '.');
  git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-m', 'external');
  git(seed, 'push', remote, 'HEAD:refs/heads/master');
  assert.equal((await call('/api/weeks/2026-W41/s1', 'H1', 'PUT', edited)).status, 204);
  assert.equal((await call('/api/weeks/2026-W41', 'H1')).body.s3.items.length, 0);

  // publish: division only, versions increment, snapshots immutable
  assert.equal((await call('/api/weeks/2026-W41/publications', 'H1', 'POST')).status, 403);
  assert.deepEqual((await call('/api/publications', 'H1')).body, { publications: [] });
  const v1 = await call('/api/weeks/2026-W41/publications', 'G', 'POST');
  assert.equal(v1.status, 201); assert.equal(v1.body.version, 1);
  const before = (await call('/api/weeks/2026-W41', 'H1')).body;
  const changed = { ...before.s1, items: before.s1.items.slice(0, 1) };
  assert.equal((await call('/api/weeks/2026-W41/s1', 'H1', 'PUT', changed)).status, 204);
  assert.equal((await call('/api/weeks/2026-W41/publications', 'G', 'POST')).body.version, 2);
  assert.equal((await call('/api/weeks/2026-W42/publications', 'G', 'POST')).status, 404);
  const index = (await call('/api/publications', 'H1')).body.publications;
  assert.deepEqual(index.map(p => [p.week, p.version, p.publishedBy, p.path]), [['2026-W41', 1, 'G', 'publications/2026-W41/v1'], ['2026-W41', 2, 'G', 'publications/2026-W41/v2']]);
  assert.ok(index[0].publishedAt);
  const snap1 = (await call('/api/publications/2026-W41/1', 'H1')).body;
  assert.deepEqual(snap1.s1.items, before.s1.items);
  assert.equal((await call('/api/publications/2026-W41/2', 'H1')).body.s1.items.length, 1);
  assert.equal((await call('/api/publications/2026-W41/3', 'H1')).status, 404);
  assert.equal((await call('/api/publications/2026-41/1', 'H1')).status, 400);
  assert.deepEqual(git(remote, 'tag', '--list', 'pub/*').trim().split(/[^A-Za-z0-9/.-]+/), ['pub/2026-W41-v1', 'pub/2026-W41-v2']);
  assert.match(git(remote, 'log', '--format=%s', 'master'), /2026-W41: publish v2 by G/);
  const snap2 = (await call('/api/publications/2026-W41/2', 'H1')).body;
  // create next week: division only, copies latest snapshot (week rewritten), 409 when it exists
  assert.equal((await call('/api/weeks', 'H1', 'POST')).status, 403);
  const created = await call('/api/weeks', 'G', 'POST');
  assert.equal(created.status, 201); assert.equal(created.body.week, '2026-W42');
  const w42 = (await call('/api/weeks/2026-W42', 'H1')).body;
  assert.equal(w42.s1.week, '2026-W42'); assert.equal(w42.s1.section, 's1');
  assert.deepEqual(w42.s1.items, snap2.s1.items); assert.equal(w42.cross.managementSummary, snap2.cross.managementSummary);
  assert.equal((await call('/api/weeks', 'G', 'POST')).status, 409);
  assert.match(git(remote, 'log', '--format=%s', 'master'), /2026-W42: create by G/);
  // engineer work: week picks file by name date, latest wins, no file 404, badly named ignored, invalid week 400
  const ew = await call('/api/weeks/2026-W41/engineer-work', 'H1');
  assert.equal(ew.status, 200); assert.deepEqual(Object.keys(ew.body.results), ['alice', 'bob']);
  assert.equal(ew.body.results.alice.items[0].workContent, '部署管線改版');
  assert.equal((await call('/api/weeks/2026-W40/engineer-work', 'G')).body.results.alice.items[0].workId, 1);
  assert.equal((await call('/api/weeks/2026-W42/engineer-work', 'H1')).status, 404);
  assert.equal((await call('/api/weeks/2026-42/engineer-work', 'H1')).status, 400);
  // engineer intake (W42 exists after the create above)
  assert.equal((await upload('G', 'CIM2_ENG_WeeklyReport_261014_SEC1.json')).status, 403);
  const wrongSection = await upload('H1', 'CIM2_ENG_WeeklyReport_261014_SEC2.json'); assert.equal(wrongSection.status, 400); assert.match(wrongSection.body.error, /s2.*s1/);
  assert.equal((await upload('H1', 'not-dated.json')).status, 400);
  assert.equal((await upload('H1', 'CIM2_ENG_WeeklyReport_261014_bad.json')).status, 400);
  assert.equal((await upload('H1', 'CIM2_ENG_WeeklyReport_261014_missing.json')).status, 400);
  assert.match((await upload('H1', 'CIM2_ENG_WeeklyReport_261030_SEC1.json', intake('CIM2_ENG_WeeklyReport_261014_SEC1.json'))).body.error, /尚未建立/);
  const noPercent = JSON.parse(intake('CIM2_ENG_WeeklyReport_261014_SEC1.json')); delete noPercent.results.alice.items[0].percentage;
  assert.match((await upload('H1', 'CIM2_ENG_WeeklyReport_261014_SEC1.json', JSON.stringify(noPercent))).body.error, /percentage/);
  // annotations: upload-carried star/comment import as initial; W41 first so W42 can show last week's comment
  const annotated = (name, comment) => { const f = JSON.parse(intake(name)); Object.assign(f.results.alice.items[0], { isImportant: true, managerComment: comment }); return JSON.stringify(f); };
  assert.equal((await upload('H1', 'CIM2_ENG_WeeklyReport_261008_SEC1.json', annotated('CIM2_ENG_WeeklyReport_261008_SEC1.json', 'W41評語'))).status, 201);
  const w41 = (await call('/api/weeks/2026-W41/engineer/s1', 'H1')).body.results.alice.items[0];
  assert.deepEqual([w41.isImportant, w41.managerComment], [true, 'W41評語']);
  const up1 = await upload('H1', 'CIM2_ENG_WeeklyReport_261014_SEC1.json', annotated('CIM2_ENG_WeeklyReport_261014_SEC1.json', '匯入評語')); assert.equal(up1.status, 201); assert.equal(up1.body.week, '2026-W42');
  assert.match(git(remote, 'log', '--format=%s', 'master'), /2026-W42\/engineer-s1: upload by H1/);
  // same week again merges by workId: new values win, absent works kept and flagged, sub levels merged
  assert.equal((await upload('H1', 'CIM2_ENG_WeeklyReport_261015_SEC1.json', annotated('CIM2_ENG_WeeklyReport_261015_SEC1.json', '重傳評語'))).status, 201);
  const merged = (await call('/api/weeks/2026-W42/engineer/s1', 'H1')).body.results;
  const a = merged.alice.items;
  assert.deepEqual(a.map(i => [i.workId, i.percentage, !!i.absent]), [[100, 55, false], [200, 0, true]]);
  assert.deepEqual(a[0].subItems.map(i => [i.workId, i.percentage, !!i.absent]), [[101, 45, false]]);
  assert.deepEqual(a[0].subItems[0].subItems.map(i => [i.workId, !!i.absent]), [[102, true]]);
  assert.equal(a[0].subItems[0].subItems[0].deltaPert, '?');
  assert.equal(a[1].rmsFlag, 'R');
  // re-upload replaces an import nobody touched on the site (and only that); last week's comment shows beside the same workId
  const first42 = merged.alice.items[0];
  assert.deepEqual([first42.isImportant, first42.managerComment, first42.lastComment], [true, '重傳評語', 'W41評語']);
  const put = (user, work, body, week = '2026-W42', section = 's1') => call(`/api/weeks/${week}/engineer/${section}/works/${work}`, user, 'PUT', body);
  assert.equal((await put('H1', 101, { isImportant: true, managerComment: '子項評語' })).status, 204);
  assert.equal((await put('H1', 100, { isImportant: false, managerComment: '' })).status, 204);
  assert.equal((await put('H1', 999, { isImportant: true, managerComment: 'x' })).status, 404);
  assert.equal((await put('H1', 100, { isImportant: 'yes', managerComment: 'x' })).status, 400);
  assert.equal((await put('H2', 100, { isImportant: true, managerComment: 'x' })).status, 403);
  assert.equal((await put('G', 100, { isImportant: true, managerComment: 'x' })).status, 403);
  assert.equal((await put('H1', 100, { isImportant: true, managerComment: 'x' }, '2026-W42', 's2')).status, 403);
  const saved = (await call('/api/weeks/2026-W42/engineer/s1', 'G')).body.results.alice.items[0];
  assert.deepEqual([saved.isImportant, saved.managerComment, saved.subItems[0].isImportant, saved.subItems[0].managerComment], [false, '', true, '子項評語']);
  assert.match(git(remote, 'log', '--format=%s', 'master'), /engineer-s1: annotate 101 by H1/);
  assert.doesNotMatch(git(remote, 'show', 'master:weeks/2026-W42/engineer-s1.json'), /lastComment/);
  // re-upload after annotating still keeps site values
  assert.equal((await upload('H1', 'CIM2_ENG_WeeklyReport_261015_SEC1.json')).status, 201);
  assert.equal((await call('/api/weeks/2026-W42/engineer/s1', 'H1')).body.results.alice.items[0].subItems[0].managerComment, '子項評語');
  // older week rejected once W42 data exists... a W41 file is older than W42
  const older = await upload('H1', 'CIM2_ENG_WeeklyReport_261008_SEC1.json'); assert.equal(older.status, 409); assert.match(older.body.error, /早於/);
  // visibility: division reads any section, head only own, nothing for s2
  assert.equal((await call('/api/weeks/2026-W42/engineer/s1', 'G')).status, 200);
  assert.equal((await call('/api/weeks/2026-W42/engineer/s1', 'H2')).status, 403);
  assert.equal((await call('/api/weeks/2026-W42/engineer/s2', 'H2')).status, 404);
  assert.equal((await call('/api/weeks/2026-W42/engineer/s3', 'G')).status, 404);
  assert.equal((await call('/api/weeks/2026-W42/engineer/cross', 'G')).status, 400);
  // publication snapshot carries no engineer data or annotations; next week starts clean but shows last week's comment
  const pub = await call('/api/weeks/2026-W42/publications', 'G', 'POST'); assert.equal(pub.status, 201);
  assert.doesNotMatch(JSON.stringify((await call(`/api/publications/2026-W42/${pub.body.version}`, 'G')).body), /isImportant|managerComment|lastComment|engineer/);
  assert.ok(git(remote, 'ls-tree', '--name-only', 'master', `publications/2026-W42/v${pub.body.version}/`).split(/\r?\n/).filter(Boolean).every(n => /\/(s1|s2|s3|cross)\.json$/.test(n)));
  assert.equal((await call('/api/weeks', 'G', 'POST')).body.week, '2026-W43');
  assert.equal((await call('/api/weeks/2026-W43/engineer/s1', 'H1')).status, 404);
  assert.equal((await upload('H1', 'CIM2_ENG_WeeklyReport_261021_SEC1.json', intake('CIM2_ENG_WeeklyReport_261015_SEC1.json'))).status, 201);
  const w43 = (await call('/api/weeks/2026-W43/engineer/s1', 'H1')).body.results.alice.items[0].subItems[0];
  assert.deepEqual([!!w43.isImportant, w43.managerComment ?? '', w43.lastComment], [false, '', '子項評語']);
  console.log('API smoke passed');
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  api.kill();
  if (api.exitCode === null) await once(api, 'exit');
  jwks.close();
  try { rmSync(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) { console.warn('temp cleanup skipped (Windows file lock):', e.code, temporary); }
}
