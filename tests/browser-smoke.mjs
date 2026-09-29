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
const api = spawn('dotnet', [process.env.WEEKLY_REPORT_API_DLL ?? join(root, 'apps/api/bin/Debug/net9.0/WeeklyReport.Api.dll'), '--urls', base], {
  cwd: join(root, 'apps/api'),
  env: { ...process.env, DatabasePath: join(temporary, 'report.db'), JwksUrl: `http://127.0.0.1:${jwks.address().port}/jwks`,
    Access__Users__0__EmpNo: 'G', Access__Users__0__Name: 'Guy', Access__Users__0__Role: 'Guy',
    Access__Users__1__EmpNo: 'H1', Access__Users__1__Name: 'Head One', Access__Users__1__Role: 'Head', Access__Users__1__Section: 's1',
    Access__Users__2__EmpNo: 'H2', Access__Users__2__Name: 'Head Two', Access__Users__2__Role: 'Head', Access__Users__2__Section: 's2',
    Access__Users__3__EmpNo: 'H3', Access__Users__3__Name: 'Head Three', Access__Users__3__Role: 'Head', Access__Users__3__Section: 's3' }
});
let logs = '';
api.stdout.on('data', chunk => logs = (logs + chunk).slice(-10000));
api.stderr.on('data', chunk => logs = (logs + chunk).slice(-10000));
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const parts = `${b64({ alg: 'RS256' })}.${b64({ empNo: 'G', exp: Math.floor(Date.now() / 1000) + 3600 })}`;
const token = `${parts}.${sign('RSA-SHA256', Buffer.from(parts), privateKey).toString('base64url')}`;
async function apiCall(path, method = 'GET', body) {
  const response = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}
async function createCommittedItem(reportId, section, title, content) {
  const created = await apiCall(`/api/reports/${reportId}/items`, 'POST', { section, title, ...(section === 'personnel' ? { ownerSection: 's1' } : {}) });
  assert.equal(created.status, 201);
  const lease = await apiCall(`/api/items/${created.body.id}/lease`, 'POST', {});
  assert.equal(lease.status, 200);
  assert.equal((await apiCall(`/api/items/${created.body.id}/private-draft`, 'PUT', section === 'personnel'
    ? { title, content: '', details: { effectiveDate: '2026-10-01', handover: '交接維運系統', impact: '值班責任調整', nextStep: '確認新負責人' } }
    : { title, content })).status, 204);
  assert.equal((await apiCall(`/api/items/${created.body.id}/commit`, 'POST', { token: lease.body.token, baseVersion: lease.body.baseVersion })).status, 200);
}
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
  const longContent = '這是投影與列印驗收用的代表性長文字，涵蓋本週成果、未達成事項、風險、相依與下一步。'.repeat(18);
  for (const [section, title] of [['summary', '管理摘要'], ['projects', '專案摘要'], ['projects', '專案摘要（二）'], ['operations', '維運狀態'], ['personnel', '人事交接'], ['technology', '技術評估'], ['appendix', '來源附錄']])
    await createCommittedItem(id, section, title, longContent);
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
  await page.getByRole('button', { name: '新增來源連結' }).click();
  await page.getByRole('textbox', { name: '來源連結 URL' }).fill('https://example.test/work/42');
  await page.getByRole('textbox', { name: '待決策事項' }).fill('確認負責人');
  await page.getByLabel('新期限').fill('2026-10-08');
  await page.getByRole('button', { name: '儲存完成' }).click();
  await page.getByText('Browser committed content').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '交接維運系統' }).click();
  await page.getByRole('button', { name: '開始編輯' }).click();
  await page.getByLabel('生效日期').waitFor({ timeout: 15000 });
  assert.equal(await page.getByLabel('職責或系統交接').inputValue(), '交接維運系統');
  await page.getByLabel('下一步').fill('完成簽收');
  await page.getByRole('button', { name: '儲存完成' }).click();
  await page.getByText('完成簽收').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '專案摘要', exact: true }).click();
  await page.getByRole('button', { name: '開始編輯' }).click();
  const schedulePanel = page.locator('.project-schedule');
  await schedulePanel.getByLabel('名稱').fill('驗收階段');
  await schedulePanel.getByLabel('原始計畫開始').fill('2026-10-01');
  await schedulePanel.getByLabel('原始計畫結束').fill('2026-10-07');
  await schedulePanel.getByRole('button', { name: '新增時程' }).click();
  await schedulePanel.getByText('階段：驗收階段').waitFor({ timeout: 15000 });
  await page.getByText('已儲存結構化時程。').waitFor({ timeout: 15000 });
  await schedulePanel.getByRole('button', { name: '編輯' }).click();
  await schedulePanel.getByLabel('目前計畫結束').fill('2026-10-10');
  await schedulePanel.getByLabel('修改原因').fill('整合測試延長');
  await schedulePanel.getByRole('button', { name: '儲存時程' }).click();
  await schedulePanel.getByText('完成偏差 +3 天').waitFor({ timeout: 15000 });
  await schedulePanel.getByRole('button', { name: '修訂紀錄' }).click();
  await schedulePanel.getByText('整合測試延長').waitFor({ timeout: 15000 });
  await schedulePanel.getByLabel('類型').selectOption('task');
  await schedulePanel.getByLabel('名稱').fill('交付檢核');
  await schedulePanel.getByLabel('負責人或單位').fill('外部測試單位');
  await schedulePanel.getByLabel('所屬階段').selectOption({ label: '驗收階段' });
  await schedulePanel.getByLabel('原始計畫開始').fill('2026-10-02');
  await schedulePanel.getByLabel('原始計畫結束').fill('2026-10-08');
  await schedulePanel.getByRole('button', { name: '新增時程' }).click();
  await schedulePanel.getByText('關鍵任務：交付檢核').waitFor({ timeout: 15000 });
  await schedulePanel.getByText('尚有 1 項未完成任務').waitFor({ timeout: 15000 });
  await schedulePanel.getByRole('button', { name: '編輯' }).first().click();
  await schedulePanel.getByLabel('狀態').selectOption('completed');
  await schedulePanel.getByLabel('實際開始').fill('2026-10-01');
  await schedulePanel.getByLabel('實際結束').fill('2026-10-10');
  await schedulePanel.getByLabel('修改原因', { exact: true }).fill('交付已驗收，檢核工作後續補完');
  assert.equal(await schedulePanel.getByRole('button', { name: '儲存時程' }).isDisabled(), true);
  await schedulePanel.getByLabel('我已檢視未完成任務').check();
  await schedulePanel.getByRole('button', { name: '儲存時程' }).click();
  await schedulePanel.getByText('完成偏差 +3 天').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: '發布正式版' }).click();
  const publication = page.getByRole('link', { name: '查看剛發布的固定版本' });
  await publication.waitFor({ timeout: 15000 });
  await publication.click();
  await page.getByRole('heading', { name: '正式處會週報' }).waitFor({ timeout: 15000 });
  await page.getByText('版本 1').waitFor({ timeout: 15000 });
  await page.getByRole('heading', { name: '來源狀態' }).waitFor({ timeout: 15000 });
  assert.equal(await page.getByText('尚未接入來源').count(), 3);
  await page.getByText('這是投影與列印驗收用的代表性長文字', { exact: false }).first().waitFor({ timeout: 15000 });
  assert.equal(await page.getByRole('heading', { name: '專案摘要', exact: true }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: '專案摘要（二）', exact: true }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: '交接維運系統', exact: true }).count(), 1);
  await page.getByText('完成簽收').waitFor({ timeout: 15000 });
  await page.getByRole('link', { name: '來源' }).waitFor({ timeout: 15000 });
  await page.getByText('確認負責人', { exact: false }).waitFor({ timeout: 15000 });
  assert.match(page.url(), new RegExp(`#/publications/`));
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('header a').evaluate(element => getComputedStyle(element).display), 'none');
  assert.equal(await page.locator('nav').count(), 0);
  assert.equal(await page.locator('.publication article').first().evaluate(element => getComputedStyle(element).breakInside), 'avoid');
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  assert.ok(pdf.length > 1000, 'print PDF should contain the representative publication');
  console.log('Browser smoke passed: SSO return, item commit, publication, and print layout');
} finally {
  await browser?.close();
  api.kill();
  if (api.exitCode === null) await once(api, 'exit');
  jwks.close();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
