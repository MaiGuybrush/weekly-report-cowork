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
    DataRepo__Path: work, DataRepo__Remote: remote,
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
