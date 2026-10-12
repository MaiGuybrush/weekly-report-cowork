import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || pathToFileURL(join(root, 'apps/web/node_modules/playwright/index.mjs')).href);
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
async function call(path, user, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token(user)}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
let browser;
try {
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base)).ok) break; } catch {} await new Promise(r => setTimeout(r, 100)); }
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
  const context = await browser.newContext();
  const jwt = token('H1');
  await context.route('**/assets/config.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ apiBaseUrl: '', uacBaseUrl: 'http://mock-uac.test/auth' }) }));
  await context.route('http://mock-uac.test/auth/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify({ token: jwt, refreshToken: 'r' }) }));
  const page = await context.newPage();
  page.on('console', m => m.type() === 'error' && console.error('CONSOLE', m.text().slice(0, 600)));
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.addInitScript(([t]) => { localStorage.setItem('CIM_TK', t); localStorage.setItem('CIM_RTK', 'r'); }, [jwt]);
  const url = `${base}/#/weeks/2026-W41`;
  await page.goto(url);
  const s1 = page.locator('[data-file="s1"]');
  await s1.locator('[data-add-project]').waitFor({ timeout: 15000 });
  await s1.locator('[data-add-project]').click();
  const project = s1.locator('app-project-schedule').last();
  await project.locator('[data-field="project-title"]').fill('新平台');
  await project.locator('[data-field="project-owner"]').fill('王小明');
  const addEntry = async (kind, name) => {
    await project.locator(`[data-add-entry="${kind}"]`).click();
    await project.locator('[data-field="entry-name"]').last().fill(name);
  };
  await addEntry('phase', '設計階段');
  await project.locator('[data-field="planStart"]').last().fill('2026-10-01');
  await project.locator('[data-field="planEnd"]').last().fill('2026-10-20');
  await addEntry('task', '撰寫規格');
  await project.locator('[data-entry="撰寫規格"] select').first().selectOption({ label: '設計階段' });
  await project.locator('[data-field="planStart"]').last().fill('2026-10-02');
  await project.locator('[data-field="planEnd"]').last().fill('2026-10-10');
  await addEntry('milestone', '上線');
  await project.locator('[data-field="planDate"]').last().fill('2026-10-30');
  // phase <- direct child link is rejected, and save is blocked
  await project.locator('[data-entry="撰寫規格"] [data-field="predecessors"]').selectOption({ label: '設計階段' });
  await project.getByRole('alert').first().waitFor({ timeout: 5000 });
  await s1.locator('[data-save]').click();
  await page.getByText(/時程有誤，未儲存/).waitFor({ timeout: 5000 });
  // valid link: milestone after task
  await project.locator('[data-entry="撰寫規格"] [data-field="predecessors"]').selectOption([]);
  await project.locator('[data-entry="上線"] [data-field="predecessors"]').selectOption({ label: '撰寫規格' });
  // pick an engineer work item with a summary, plus a manual one
  await project.locator('[data-entry="撰寫規格"] [data-evidence-toggle]').click();
  await project.locator('[data-work="101"] [data-pick]').click();
  await project.locator('[data-field="evidence-summary"]').last().fill('管線已上線');
  await project.locator('[data-field="manual-work-id"]').fill('555');
  await project.locator('[data-manual-add]').click();
  await project.locator('[data-field="evidence-summary"]').last().fill('手動補充');
  await s1.locator('[data-save]').click();
  await page.getByText('已儲存。').waitFor({ timeout: 15000 });

  await page.reload();
  const again = page.locator('[data-file="s1"] app-project-schedule').last();
  await again.locator('.gantt-row').first().waitFor({ timeout: 15000 });
  assert.equal(await again.locator('[data-field="project-title"]').inputValue(), '新平台');
  assert.equal(await again.locator('.gantt-row-phase').count(), 1);
  assert.equal(await again.locator('.gantt-row-milestone').count(), 1);
  const saved = (await (await fetch(base + '/api/weeks/2026-W41', { headers: { Authorization: `Bearer ${jwt}` } })).json()).s1.items.find(i => i.title === '新平台');
  assert.deepEqual(saved.schedule.find(e => e.name === '上線').predecessors, [saved.schedule.find(e => e.name === '撰寫規格').id]);
  for (const k of ['successors', 'warnings', 'externalNotices', 'history', 'version', 'continuityId']) assert.ok(saved.schedule.every(e => !(k in e)), k);
  assert.deepEqual(saved.schedule.find(e => e.name === '撰寫規格').evidenceLinks, [{ workId: 101, summary: '管線已上線' }, { workId: 555, summary: '手動補充' }]);
  await again.locator('.btn-phase-expand').click();
  assert.match(await again.locator('.gantt-evidence-chip').innerText(), /2/);
  // section head sees cross read-only
  assert.equal(await page.locator('[data-file="cross"] [data-save]').count(), 0);
  assert.equal(await page.locator('[data-file="cross"] [data-field="managementSummary"]').isDisabled(), true);

  // division head edits cross and it persists
  const guyJwt = token('G');
  const guyContext = await browser.newContext();
  await guyContext.route('**/assets/config.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ apiBaseUrl: '', uacBaseUrl: 'http://mock-uac.test/auth' }) }));
  await guyContext.route('http://mock-uac.test/auth/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify({ token: guyJwt, refreshToken: 'r' }) }));
  const guyPage = await guyContext.newPage();
  await guyPage.addInitScript(([t]) => { localStorage.setItem('CIM_TK', t); localStorage.setItem('CIM_RTK', 'r'); }, [guyJwt]);
  await guyPage.goto(url);
  const cross = guyPage.locator('[data-file="cross"]');
  await cross.locator('[data-field="managementSummary"]').fill('本週有一項風險。');
  await cross.locator('[data-add-decision]').click();
  await cross.locator('[data-field="decision-description"]').last().fill('是否延後上線');
  await cross.locator('[data-save]').click();
  await guyPage.getByText('已儲存。').waitFor({ timeout: 15000 });
  assert.equal(await guyPage.locator('[data-file="s1"] [data-add-project]').count(), 0);
  await guyPage.reload();
  await guyPage.locator('[data-file="cross"] [data-field="managementSummary"]').waitFor({ timeout: 15000 });
  await guyPage.waitForFunction(() => document.querySelector('[data-file="cross"] [data-field="managementSummary"]')?.value === '本週有一項風險。', null, { timeout: 15000 });
  assert.equal(await guyPage.locator('[data-file="cross"] [data-field="decision-description"]').last().inputValue(), '是否延後上線');

  // create next week with no publication yet: empty files; only division head sees the button
  assert.equal(await page.locator('[data-create-week]').count(), 0);
  await guyPage.goto(base + '/#/');
  await guyPage.locator('[data-create-week]').click();
  await guyPage.locator('a[href="#/weeks/2026-W42"]').waitFor({ timeout: 15000 });
  const w42 = await (await fetch(base + '/api/weeks/2026-W42', { headers: { Authorization: `Bearer ${jwt}` } })).json();
  assert.deepEqual(w42.s1, { section: 's1', week: '2026-W42' });
  await guyPage.goto(url);

  // division head publishes and lands on the publication page; section head cannot publish
  assert.equal(await page.locator('[data-publish]').count(), 0);
  await guyPage.locator('[data-publish]').click();
  await guyPage.waitForURL(/#\/publications\/2026-W41\/1$/, { timeout: 15000 });
  await guyPage.locator('[data-file="s1"] app-project-schedule .gantt-row').first().waitFor({ timeout: 15000 });
  assert.equal(await guyPage.locator('[data-file="s1"] [data-field="project-title"]').last().isDisabled(), true);
  assert.equal(await guyPage.locator('[data-file="cross"] p').first().innerText(), '本週有一項風險。');
  // publish a second version from the draft, then switch back to v1
  await guyPage.goto(url);
  await guyPage.locator('[data-publish]').click();
  await guyPage.waitForURL(/#\/publications\/2026-W41\/2$/, { timeout: 15000 });
  await guyPage.locator('[data-version-select]').selectOption('2026-W41/1');
  await guyPage.waitForURL(/#\/publications\/2026-W41\/1$/, { timeout: 15000 });
  await guyPage.getByRole('heading', { name: /v1$/ }).waitFor({ timeout: 15000 });
  console.log('browser smoke passed');
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  await browser?.close();
  api.kill();
  if (api.exitCode === null) await once(api, 'exit');
  jwks.close();
  rmSync(temporary, { recursive: true, force: true });
}
