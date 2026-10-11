import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
  env: { ...process.env, DatabasePath: join(temporary, 'report.db'), JwksUrl: `http://127.0.0.1:${jwks.address().port}/jwks`,
    DataRepo__Path: work, DataRepo__Remote: remote, EngineerWork__Path: join(root, 'tests/fixtures/engineer-work'),
    Access__Users__0__EmpNo: 'G', Access__Users__0__Name: 'Guy', Access__Users__0__Role: 'Guy',
    Access__Users__1__EmpNo: 'H1', Access__Users__1__Name: 'Head One', Access__Users__1__Role: 'Head', Access__Users__1__Section: 's1',
    Access__Users__2__EmpNo: 'H2', Access__Users__2__Name: 'Head Two', Access__Users__2__Role: 'Head', Access__Users__2__Section: 's2' }
});
let logs = '';
api.stdout.on('data', c => logs = (logs + c).slice(-10000));
api.stderr.on('data', c => logs = (logs + c).slice(-10000));
const base = `http://127.0.0.1:${port}`;
const b64 = v => Buffer.from(JSON.stringify(v)).toString('base64url');
const token = empNo => { const p = `${b64({ alg: 'RS256' })}.${b64({ empNo, exp: Math.floor(Date.now() / 1000) + 3600 })}`; return `${p}.${sign('RSA-SHA256', Buffer.from(p), privateKey).toString('base64url')}`; };
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
  console.log('weeks API smoke passed');
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  api.kill();
  if (api.exitCode === null) await once(api, 'exit');
  jwks.close();
  rmSync(temporary, { recursive: true, force: true });
}
