import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const temporary = await mkdtemp(join(tmpdir(), 'weekly-report-smoke-'));
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
const jwks = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [{ ...jwk, kid: 'test', alg: 'RS256' }] })); });
await new Promise(resolve => jwks.listen(0, '127.0.0.1', resolve));
const jwksPort = jwks.address().port;
const port = await new Promise(resolve => { const s = createTcpServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const api = spawn('dotnet', [join(root, 'apps/api/bin/Debug/net9.0/WeeklyReport.Api.dll'), '--urls', `http://127.0.0.1:${port}`], {
  cwd: join(root, 'apps/api'),
  env: { ...process.env, DatabasePath: join(temporary, 'report.db'), JwksUrl: `http://127.0.0.1:${jwksPort}/jwks`, LeaseDurationSeconds: '4',
    Access__Users__0__EmpNo: 'G', Access__Users__0__Name: 'Guy', Access__Users__0__Role: 'Guy',
    Access__Users__1__EmpNo: 'H1', Access__Users__1__Name: 'Head One', Access__Users__1__Role: 'Head', Access__Users__1__Section: 's1',
    Access__Users__2__EmpNo: 'H2', Access__Users__2__Name: 'Head Two', Access__Users__2__Role: 'Head', Access__Users__2__Section: 's2',
    Access__Users__3__EmpNo: 'R', Access__Users__3__Name: 'Reader', Access__Users__3__Role: 'Reader',
    Access__Users__4__EmpNo: 'H3', Access__Users__4__Name: 'Head Three', Access__Users__4__Role: 'Head', Access__Users__4__Section: 's3' }
});
let logs = '';
api.stdout.on('data', chunk => logs = (logs + chunk).slice(-10000));
api.stderr.on('data', chunk => logs = (logs + chunk).slice(-10000));
const base = `http://127.0.0.1:${port}`;
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
function token(empNo, expires = Math.floor(Date.now() / 1000) + 3600) {
  const parts = `${b64({ alg: 'RS256', kid: 'test' })}.${b64({ empNo, exp: expires })}`;
  return `${parts}.${sign('RSA-SHA256', Buffer.from(parts), privateKey).toString('base64url')}`;
}
async function call(path, user, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { ...(user ? { Authorization: `Bearer ${token(user)}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { await fetch(base); ready = true; break; } catch { await new Promise(resolve => setTimeout(resolve, 100)); }
  }
  assert.ok(ready, `API did not start: ${logs}`);
  assert.equal((await call('/api/me')).status, 401);
  assert.equal((await call('/api/me', 'missing')).status, 403);
  assert.equal((await call('/api/me', 'G')).body.role, 'Guy');
  assert.equal((await call('/api/reports', 'R')).status, 403);
  assert.equal((await call('/api/publications/latest', 'R')).status, 404);
  assert.equal((await call('/api/access/users', 'H1', 'POST', { empNo: 'R2', name: 'Reader Two', role: 'Reader' })).status, 403);
  const readerAdded = await call('/api/access/users', 'G', 'POST', { empNo: 'R2', name: 'Reader Two', role: 'Reader' });
  assert.equal(readerAdded.status, 200);
  assert.equal((await call('/api/me', 'R2')).body.role, 'Reader');
  const accessAudit = await call('/api/access/audit', 'G');
  assert.equal(accessAudit.status, 200);
  assert.equal(accessAudit.body[0].empNo, 'R2');
  assert.equal(accessAudit.body[0].beforeReaderAccess, false);
  assert.equal(accessAudit.body[0].afterReaderAccess, true);
  const expired = await fetch(base + '/api/me', { headers: { Authorization: `Bearer ${token('G', 1)}` } });
  assert.equal(expired.status, 401);
  const bad = token('G').slice(0, -5) + 'xxxxx';
  assert.equal((await fetch(base + '/api/me', { headers: { Authorization: `Bearer ${bad}` } })).status, 401);
  assert.equal((await call('/api/reports', 'H1', 'POST', { meetingDate: '2026-10-01' })).status, 403);
  assert.equal((await call('/api/reports', 'R', 'POST', { meetingDate: '2026-10-01' })).status, 403);
  const first = await call('/api/reports', 'G', 'POST', { meetingDate: '2026-10-01' });
  assert.equal(first.status, 200);
  assert.equal(first.body.sections.length, 6);
  const retry = await call('/api/reports', 'G', 'POST', { meetingDate: '2026-10-01' });
  assert.equal(retry.body.id, first.body.id);
  const reportId = first.body.id;
  assert.equal((await call(`/api/reports/${reportId}`, 'H1')).body.items.length, 0);
  assert.equal((await call(`/api/reports/${reportId}/items`, 'H1', 'POST', { section: 'operations', ownerSection: 's2', title: 'bad' })).status, 403);
  const created = await call(`/api/reports/${reportId}/items`, 'H1', 'POST', { section: 'projects', title: 'Project A' });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await call(`/api/items/${id}/project-participants`, 'H2', 'POST', { section: 's2' })).status, 403);
  assert.equal((await call(`/api/items/${id}/project-participants`, 'H1', 'POST', { section: 's2' })).status, 204);
  assert.equal((await call(`/api/items/${id}/project-work`, 'H3')).status, 403);
  const projectWork = await call(`/api/items/${id}/project-work`, 'H2', 'PUT', { work: 'Complete integration testing', scheduleProposal: 'Move integration milestone to 2026-10-08', baseVersion: 0 });
  assert.equal(projectWork.status, 200);
  const ownProjectWork = await call(`/api/items/${id}/project-work`, 'H2');
  assert.equal(ownProjectWork.body[0].section, 's2');
  assert.equal(ownProjectWork.body[0].work, 'Complete integration testing');
  assert.equal(ownProjectWork.body[0].scheduleProposal, 'Move integration milestone to 2026-10-08');
  assert.equal(ownProjectWork.body[0].version, 1);
  assert.equal((await call(`/api/items/${id}/project-work`, 'H2', 'PUT', { work: 'Stale update', baseVersion: 0 })).status, 409);
  const maintainerProjectWork = await call(`/api/items/${id}/project-work`, 'H1');
  assert.equal(maintainerProjectWork.body[0].section, 's2');
  const personnel = await call(`/api/reports/${reportId}/items`, 'H1', 'POST', { section: 'personnel', title: 'Handover' });
  assert.equal((await call(`/api/items/${personnel.body.id}`, 'H2')).status, 403);
  assert.equal((await call(`/api/items/${personnel.body.id}/private-draft`, 'H2')).status, 403);
  assert.equal((await call(`/api/reports/${reportId}/items`, 'G', 'POST', { section: 'personnel', ownerSection: 'unknown', title: 'Invalid handover' })).status, 400);
  const guyPersonnel = await call(`/api/reports/${reportId}/items`, 'G', 'POST', { section: 'personnel', ownerSection: 's2', title: 'S2 handover' });
  const s2Report = await call(`/api/reports/${reportId}`, 'H2');
  assert.equal(s2Report.status, 200);
  assert.equal(s2Report.body.items.some(item => item.id === guyPersonnel.body.id), true);
  assert.equal((await call(`/api/items/${guyPersonnel.body.id}`, 'H2')).status, 200);
  assert.equal((await call(`/api/items/${guyPersonnel.body.id}/private-draft`, 'H2')).status, 404);
  const s1Report = await call(`/api/reports/${reportId}`, 'H1');
  assert.equal(s1Report.status, 200);
  assert.equal(s1Report.body.items.some(item => item.id === guyPersonnel.body.id), false);
  assert.equal((await call(`/api/reports/${reportId}`, 'G')).body.items.some(item => item.id === guyPersonnel.body.id), true);
  assert.equal((await call(`/api/items/${id}`, 'G')).status, 404);
  const other = await call(`/api/reports/${reportId}/items`, 'H2', 'POST', { section: 'operations', title: 'Operations A' });
  const [lease1, lease2] = await Promise.all([call(`/api/items/${id}/lease`, 'H1', 'POST', {}), call(`/api/items/${other.body.id}/lease`, 'H2', 'POST', {})]);
  assert.equal(lease1.status, 200);
  assert.equal(lease2.status, 200);
  assert.equal((await call(`/api/items/${id}/lease`, 'G', 'POST', {})).status, 409);
  assert.equal((await call(`/api/items/${id}/private-draft`, 'H1', 'PUT', { title: 'Project A draft', content: 'private work' })).status, 204);
  assert.equal((await call(`/api/items/${id}/private-draft`, 'G')).status, 404);
  assert.equal((await call(`/api/items/${id}`, 'G')).status, 404);
  assert.equal((await call(`/api/items/${id}/commit`, 'H1', 'POST', { token: 'wrong', baseVersion: 0 })).status, 409);
  assert.equal((await call(`/api/items/${id}`, 'G')).status, 404);
  assert.equal((await call(`/api/items/${id}/lease/takeover`, 'G', 'POST', { reason: '' })).status, 400);
  const takeover = await call(`/api/items/${id}/lease/takeover`, 'G', 'POST', { reason: 'Head unavailable' });
  assert.equal(takeover.status, 200);
  assert.equal((await call(`/api/items/${id}/private-draft`, 'G', 'PUT', { title: 'Project A official', content: 'committed text' })).status, 204);
  assert.equal((await call(`/api/items/${id}/commit`, 'G', 'POST', { token: takeover.body.token, baseVersion: 0 })).status, 200);
  const conflict = await call(`/api/items/${id}/commit`, 'H1', 'POST', { token: lease1.body.token, baseVersion: 0 });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.latest.version, 1);
  assert.equal(conflict.body.draft.content, 'private work');
  assert.equal((await call(`/api/items/${id}`, 'H1')).body.content, 'committed text');
  const history = await call(`/api/items/${id}/history`, 'H1');
  assert.equal(history.body.find(x => x.action === 'takeover').reason, 'Head unavailable');
  assert.equal(history.body.find(x => x.action === 'commit').afterVersion, 1);
  assert.equal((await call(`/api/items/${id}/history`, 'H2')).status, 403);
  assert.equal((await call(`/api/items/${other.body.id}/lease/renew`, 'H2', 'POST', { token: lease2.body.token })).status, 204);
  const racing = await call(`/api/reports/${reportId}/items`, 'H1', 'POST', { section: 'projects', title: 'Racing item' });
  const contenders = await Promise.all([call(`/api/items/${racing.body.id}/lease`, 'H1', 'POST', {}), call(`/api/items/${racing.body.id}/lease`, 'G', 'POST', {})]);
  assert.deepEqual(contenders.map(result => result.status).sort(), [200, 409]);
  const editors = [ ['G', 'summary'], ['H1', 'projects'], ['H2', 'operations'], ['H3', 'technology'] ];
  const parallelItems = await Promise.all(editors.map(async ([user, section]) => {
    const created = await call(`/api/reports/${reportId}/items`, user, 'POST', { section, title: `${user} item` });
    assert.equal(created.status, 201);
    return created.body.id;
  }));
  const parallelLeases = await Promise.all(parallelItems.map((itemId, i) => call(`/api/items/${itemId}/lease`, editors[i][0], 'POST', {})));
  assert.ok(parallelLeases.every(result => result.status === 200));
  await Promise.all(parallelItems.map((itemId, i) => call(`/api/items/${itemId}/private-draft`, editors[i][0], 'PUT', { title: `${editors[i][0]} done`, content: 'parallel' })));
  const parallelCommits = await Promise.all(parallelItems.map((itemId, i) => call(`/api/items/${itemId}/commit`, editors[i][0], 'POST', { token: parallelLeases[i].body.token, baseVersion: 0 })));
  assert.ok(parallelCommits.every(result => result.status === 200));
  const expiring = await call(`/api/reports/${reportId}/items`, 'H1', 'POST', { section: 'projects', title: 'Expiring' });
  const expiringId = expiring.body.id;
  const oldLease = await call(`/api/items/${expiringId}/lease`, 'H1', 'POST', {});
  await call(`/api/items/${expiringId}/private-draft`, 'H1', 'PUT', { title: 'Expiring draft', content: 'saved despite expiration' });
  await new Promise(resolve => setTimeout(resolve, 4200));
  const stale = await call(`/api/items/${expiringId}/commit`, 'H1', 'POST', { token: oldLease.body.token, baseVersion: 0 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.draft.content, 'saved despite expiration');
  assert.equal((await call(`/api/items/${expiringId}/lease`, 'G', 'POST', {})).status, 200);
  const firstPublication = await call(`/api/reports/${reportId}/publications`, 'G', 'POST', { requestId: 'publication-1' });
  assert.equal(firstPublication.status, 201);
  assert.equal(firstPublication.body.version, 1);
  assert.equal(firstPublication.body.publishedBy, 'G');
  assert.equal(firstPublication.body.url, `/#/publications/${firstPublication.body.id}`);
  assert.equal((await call(`/api/reports/${reportId}/publications`, 'H1', 'POST', { requestId: 'publication-head' })).status, 403);
  const publicationRetry = await call(`/api/reports/${reportId}/publications`, 'G', 'POST', { requestId: 'publication-1' });
  assert.equal(publicationRetry.body.id, firstPublication.body.id);
  assert.equal(publicationRetry.body.publishedBy, 'G');
  assert.equal(publicationRetry.body.url, firstPublication.body.url);
  const published = await call(`/api/publications/${firstPublication.body.id}`, 'R');
  assert.equal(published.status, 200);
  assert.equal(published.body.version, 1);
  assert.equal(published.body.items.find(item => item.id === id).content, 'committed text');
  assert.equal((await call('/api/publications/latest', 'R2')).body.id, firstPublication.body.id);
  assert.equal((await call(`/api/publications/${firstPublication.body.id}`, 'missing')).status, 403);
  assert.equal((await call(`/api/publications/${firstPublication.body.id}`, 'H1')).status, 403);
  assert.equal((await call('/api/access/users', 'G', 'POST', { empNo: 'H1', name: 'Head One', role: 'Head', section: 's1', readerAccess: true })).body.readerAccess, true);
  assert.equal((await call('/api/me', 'H1')).body.readerAccess, true);
  assert.equal((await call(`/api/publications/${firstPublication.body.id}`, 'H1')).status, 200);
  const publishedItem = await call(`/api/items/${id}`, 'G');
  const postPublicationLease = await call(`/api/items/${id}/lease`, 'G', 'POST', {});
  assert.equal((await call(`/api/items/${id}/private-draft`, 'G', 'PUT', { title: 'Project A revised', content: 'changed after publication' })).status, 204);
  assert.equal((await call(`/api/items/${id}/commit`, 'G', 'POST', { token: postPublicationLease.body.token, baseVersion: publishedItem.body.version })).status, 200);
  assert.equal((await call(`/api/publications/${firstPublication.body.id}`, 'R')).body.items.find(item => item.id === id).content, 'committed text');
  const secondPublication = await call(`/api/reports/${reportId}/publications`, 'G', 'POST', { requestId: 'publication-2' });
  assert.equal(secondPublication.body.version, 2);
  const next = await call('/api/reports', 'G', 'POST', { meetingDate: '2026-10-08' });
  assert.equal(next.status, 200);
  const carried = (await call(`/api/reports/${next.body.id}`, 'G')).body.items.find(item => item.continuityId === publishedItem.body.continuityId);
  assert.equal(carried.title, 'Project A revised');
  assert.equal(carried.content, 'changed after publication');
  assert.equal(carried.version, 1);
  const closing = await call(`/api/reports/${reportId}/items`, 'G', 'POST', { section: 'summary', title: 'Closing summary' });
  const closingLease = await call(`/api/items/${closing.body.id}/lease`, 'G', 'POST', {});
  assert.equal((await call(`/api/items/${closing.body.id}/private-draft`, 'G', 'PUT', { title: 'Closing summary', content: '', status: 'closed' })).status, 400);
  assert.equal((await call(`/api/items/${closing.body.id}/private-draft`, 'G', 'PUT', { title: 'Closing summary', content: 'Completed this week.' })).status, 204);
  assert.equal((await call(`/api/items/${closing.body.id}/commit`, 'G', 'POST', { token: closingLease.body.token, baseVersion: 0, status: 'closed' })).status, 200);
  const closingPublication = await call(`/api/reports/${reportId}/publications`, 'G', 'POST', { requestId: 'publication-3' });
  assert.equal(closingPublication.body.version, 3);
  const afterClosing = await call('/api/reports', 'G', 'POST', { meetingDate: '2026-10-15' });
  const closedItem = await call(`/api/items/${closing.body.id}`, 'G');
  assert.equal((await call(`/api/reports/${afterClosing.body.id}`, 'G')).body.items.some(item => item.continuityId === closedItem.body.continuityId), false);
  console.log('HTTP smoke passed: auth, roles, reports, leases, drafts, publication, and continuation');
} finally {
  api.kill();
  if (api.exitCode === null) await once(api, 'exit');
  jwks.close();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
