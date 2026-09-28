import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || pathToFileURL(join(root, 'apps/web/node_modules/playwright/index.mjs')).href);
const temporary = await mkdtemp(join(tmpdir(), 'weekly-report-browser-'));
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
const jwks = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys: [{ ...jwk, kid: 'browser', alg: 'RS256' }] })); });
await new Promise(resolve => jwks.listen(0, '127.0.0.1', resolve));
const port = await new Promise(resolve => { const s = createTcpServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const base = `http://127.0.0.1:${port}`;
const api = spawn('dotnet', [join(root, 'apps/api/bin/Debug/net9.0/WeeklyReport.Api.dll'), '--urls', base], {
  cwd: join(root, 'apps/api'),
  env: { ...process.env, DatabasePath: join(temporary, 'report.db'), JwksUrl: `http://127.0.0.1:${jwks.address().port}/jwks`,
    Access__Users__0__EmpNo: 'G', Access__Users__0__Name: 'Guy', Access__Users__0__Role: 'Guy' }
});
let logs = '';
api.stdout.on('data', chunk => logs = (logs + chunk).slice(-10000));
api.stderr.on('data', chunk => logs = (logs + chunk).slice(-10000));
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const parts = `${b64({ alg: 'RS256', kid: 'browser' })}.${b64({ empNo: 'G', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
const token = `${parts}.${sign('RSA-SHA256', Buffer.from(parts), privateKey).toString('base64url')}`;
let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { const response = await fetch(base); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `API did not serve Angular app: ${logs}`);
  const report = await fetch(base + '/api/reports', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingDate: '2026-10-01' }) });
  assert.equal(report.status, 200);
  const { id } = await report.json();
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  await page.route('http://tncimweb1.cminl.oa/uacapi/adAuth/**', async route => {
    const url = route.request().url();
    const body = url.endsWith('/SsoUrl') ? { loginPage: 'http://mock-sso.test/login' } : { token, refreshToken: 'test-refresh' };
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }, body: JSON.stringify(body) });
  });
  await page.route('http://mock-sso.test/**', async route => {
    const callback = new URL(route.request().url()).searchParams.get('url');
    assert.ok(callback);
    const target = new URL(callback);
    target.searchParams.set('CertificateKey', 'test-cert');
    await route.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(target.toString())})</script>` });
  });
  await page.goto(`${base}/#/reports/${id}`);
  await page.getByRole('heading', { name: /處會週報/ }).waitFor({ timeout: 15000 });
  await page.waitForURL(url => url.hash === `#/reports/${id}` && !url.searchParams.has('CertificateKey'), { timeout: 15000 });
  await page.getByText('2026-10-01').waitFor({ timeout: 15000 });
  page.once('dialog', dialog => dialog.accept('Browser item'));
  await page.getByRole('button', { name: '新增項目' }).nth(1).click();
  await page.getByRole('button', { name: 'Browser item' }).click();
  await page.getByRole('button', { name: '開始編輯' }).click();
  await page.getByRole('textbox', { name: '內容' }).fill('Browser committed content');
  await page.getByRole('button', { name: '儲存完成' }).click();
  await page.getByText('Browser committed content').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '發布正式版' }).click();
  const publication = page.getByRole('link', { name: '查看剛發布的固定版本' });
  await publication.waitFor({ timeout: 15000 });
  await publication.click();
  await page.getByRole('heading', { name: '正式處會週報' }).waitFor({ timeout: 15000 });
  await page.getByText('版本 1').waitFor({ timeout: 15000 });
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('header a').evaluate(element => getComputedStyle(element).display), 'none');
  console.log('Browser smoke passed: SSO return, item commit, publication, and print layout');
} finally {
  await browser?.close();
  api.kill();
  if (api.exitCode === null) await once(api, 'exit');
  jwks.close();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
