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
const webPort = await new Promise(resolve => { const s = createTcpServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const webOrigin = `http://127.0.0.1:${webPort}`;
const api = spawn('dotnet', [process.env.WEEKLY_REPORT_API_DLL ?? join(root, 'apps/api/bin/Debug/net9.0/WeeklyReport.Api.dll'), '--urls', base], {
  cwd: join(root, 'apps/api'),
  env: { ...process.env, DatabasePath: join(temporary, 'report.db'), JwksUrl: `http://127.0.0.1:${jwks.address().port}/jwks`, Cors__AllowedOrigins__0: webOrigin,
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
let webServer;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { const response = await fetch(base); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(ready, `API did not serve Angular app: ${logs}`);
  const configResponse = await fetch(base + '/assets/config.json');
  assert.equal(configResponse.status, 200);
  assert.equal(configResponse.headers.get('cache-control'), 'no-cache');
  webServer = createServer(async (request, response) => {
    try {
      const upstream = await fetch(base + request.url);
      response.statusCode = upstream.status;
      response.setHeader('content-type', upstream.headers.get('content-type') ?? 'application/octet-stream');
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch { response.statusCode = 502; response.end(); }
  });
  await new Promise(resolve => webServer.listen(webPort, '127.0.0.1', resolve));
  const report = await fetch(base + '/api/reports', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ meetingDate: '2026-10-01' }) });
  assert.equal(report.status, 200);
  const { id } = await report.json();
  const longContent = '這是投影與列印驗收用的代表性長文字，涵蓋本週成果、未達成事項、風險、相依與下一步。'.repeat(18);
  for (const [section, title] of [['summary', '管理摘要'], ['projects', '專案摘要'], ['projects', '專案摘要（二）'], ['operations', '維運狀態'], ['personnel', '人事交接'], ['technology', '技術評估'], ['appendix', '來源附錄']])
    await createCommittedItem(id, section, title, longContent);
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] });
  const context = await browser.newContext();
  let runtimeConfig = { apiBaseUrl: base, uacBaseUrl: 'http://mock-uac.test/auth' };
  await context.route('**/assets/config.json', route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(runtimeConfig)
  }));
  const page = await context.newPage();
  page.on('pageerror', error => console.error('Browser page error:', error.message));
  const refreshCalls = [];
  const verifyCalls = [];
  const mockUac = async route => {
    assert.equal(route.request().headers()['authorization'], undefined, 'API bearer token must not reach UAC');
    const url = route.request().url();
    const isPost = route.request().method() === 'POST';
    const requestBody = isPost ? route.request().postDataJSON() : null;
    if (isPost && url.endsWith('/RefreshToken')) refreshCalls.push(requestBody.refreshToken);
    if (isPost && url.endsWith('/VerifyCert')) {
      assert.equal(route.request().frame().url().includes('CertificateKey'), false, 'certificate must leave the URL before verification');
      verifyCalls.push(requestBody.CertificateKey);
    }
    const rejected = isPost && (url.endsWith('/RefreshToken') && !requestBody.refreshToken || url.endsWith('/VerifyCert') && requestBody.CertificateKey === 'bad-cert');
    const body = url.endsWith('/SsoUrl') ? { loginPage: 'http://mock-sso.test/login' } : { token, refreshToken: 'test-refresh' };
    await route.fulfill({ status: rejected ? 401 : 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS' }, body: JSON.stringify(body) });
  };
  await page.route('http://mock-uac.test/auth/**', mockUac);
  await page.route('http://mock-sso.test/**', async route => {
    const callback = new URL(route.request().url()).searchParams.get('url');
    assert.ok(callback);
    const target = new URL(callback);
    target.searchParams.set('CertificateKey', 'test-cert');
    await route.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(target.toString())})</script>` });
  });
  await page.goto(`${webOrigin}/#/reports/${id}`);
  await page.getByRole('heading', { name: /處會週報/ }).waitFor({ timeout: 15000 });
  await page.waitForURL(url => url.hash === `#/reports/${id}` && !url.searchParams.has('CertificateKey'), { timeout: 15000 });
  await page.getByText('2026-10-01').waitFor({ timeout: 15000 });
  assert.deepEqual(refreshCalls, [null], 'startup should attempt refresh before SSO');
  assert.deepEqual(verifyCalls, ['test-cert']);
  assert.equal(await page.evaluate(() => localStorage.getItem('CIM_TK')), token);
  assert.equal(await page.evaluate(() => localStorage.getItem('CIM_RTK')), 'test-refresh');
  await page.reload();
  await page.getByText('2026-10-01').waitFor({ timeout: 15000 });
  assert.deepEqual(refreshCalls, [null, 'test-refresh'], 'reload should refresh an existing session');
  assert.equal(new URL(page.url()).hash, `#/reports/${id}`);

  const hashPage = await context.newPage();
  await hashPage.route('http://mock-uac.test/auth/**', mockUac);
  await hashPage.goto(`${webOrigin}/#/reports/${id}?CertificateKey=hash-cert`);
  await hashPage.getByText('2026-10-01').waitFor({ timeout: 15000 });
  assert.ok(verifyCalls.includes('hash-cert'), 'hash certificate should be exchanged');
  assert.equal(new URL(hashPage.url()).hash, `#/reports/${id}`);
  assert.equal(await hashPage.evaluate(() => localStorage.getItem('CIM_TK')), token);
  await hashPage.close();

  const failedPage = await context.newPage();
  await failedPage.route('http://mock-uac.test/auth/**', mockUac);
  let failedReturnUrl;
  await failedPage.route('http://mock-sso.test/**', async route => {
    failedReturnUrl = new URL(route.request().url()).searchParams.get('url');
    await route.fulfill({ status: 200, contentType: 'text/html', body: 'SSO login' });
  });
  await failedPage.goto(`${webOrigin}/?CertificateKey=bad-cert#/reports/${id}`);
  await failedPage.waitForURL('http://mock-sso.test/**', { timeout: 15000 });
  assert.ok(verifyCalls.includes('bad-cert'));
  assert.equal(new URL(failedReturnUrl).searchParams.has('CertificateKey'), false);
  assert.equal(new URL(failedReturnUrl).hash, '');
  await failedPage.goto(`${failedReturnUrl}?CertificateKey=recovered-cert`);
  await failedPage.getByText('2026-10-01').waitFor({ timeout: 15000 });
  assert.equal(new URL(failedPage.url()).hash, `#/reports/${id}`, 'SSO should restore the route after a failed certificate');
  await failedPage.close();
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

  // 驗證連續新增交付項目能力（無需儲存草稿與重新取得租約）：
  await schedulePanel.getByText('已成功新增交付項目「交付檢核」').waitFor({ timeout: 15000 });
  assert.equal(await schedulePanel.getByLabel('類型').inputValue(), 'task');
  assert.equal(await schedulePanel.getByLabel('負責人或單位').inputValue(), '外部測試單位');
  await schedulePanel.getByLabel('名稱').fill('上線整備');
  await schedulePanel.getByLabel('原始計畫開始').fill('2026-10-04');
  await schedulePanel.getByLabel('原始計畫結束').fill('2026-10-09');
  await schedulePanel.getByRole('button', { name: '新增時程' }).click();
  await schedulePanel.getByText('關鍵任務：上線整備').waitFor({ timeout: 15000 });
  await schedulePanel.getByText('尚有 2 項未完成任務').waitFor({ timeout: 15000 });

  // Issue #10 驗證：甘特圖預設只呈現階段和里程碑，關鍵任務按需展開
  assert.equal(await schedulePanel.locator('.gantt-row.gantt-row-task').count(), 0, 'key tasks must be collapsed by default in gantt');
  await schedulePanel.locator('.btn-gantt-toggle-tasks').click();
  await schedulePanel.locator('.gantt-row-task:has-text("交付檢核")').waitFor({ timeout: 15000 });
  assert.ok(await schedulePanel.locator('.gantt-row-task').getByText('外部測試單位').count() > 0, 'task row in gantt must show owner');
  assert.ok(await schedulePanel.locator('.gantt-row-task .baseline-bar').count() > 0, 'task row in gantt must have baseline period bar');
  await schedulePanel.locator('.btn-gantt-toggle-tasks').click();
  assert.equal(await schedulePanel.locator('.gantt-row.gantt-row-task').count(), 0, 'key tasks must be collapsed when toggled');

  await schedulePanel.getByRole('button', { name: '編輯' }).first().click();
  await schedulePanel.getByLabel('狀態').selectOption('completed');
  await schedulePanel.getByLabel('實際開始').fill('2026-10-01');
  await schedulePanel.getByLabel('實際結束').fill('2026-10-10');
  await schedulePanel.getByLabel('修改原因', { exact: true }).fill('交付已驗收，檢核工作後續補完');
  assert.equal(await schedulePanel.getByRole('button', { name: '儲存時程' }).isDisabled(), true);
  await schedulePanel.getByLabel('我已檢視未完成任務').check();
  await schedulePanel.getByRole('button', { name: '儲存時程' }).click();
  await schedulePanel.getByRole('heading', { name: '新增交付項目' }).waitFor({ timeout: 15000 });
  await schedulePanel.getByLabel('類型').selectOption('milestone');
  await schedulePanel.getByLabel('目標日期').waitFor({ timeout: 15000 });
  assert.equal(await schedulePanel.getByLabel('原始計畫開始').count(), 0, 'milestone form must not have start date');
  assert.equal(await schedulePanel.getByLabel('原始計畫結束').count(), 0, 'milestone form must not have end date');
  await schedulePanel.getByLabel('名稱').fill('上線評估會議');
  await schedulePanel.getByLabel('目標日期').fill('2026-10-15');
  await schedulePanel.getByRole('button', { name: '新增時程' }).click();
  await schedulePanel.getByText('重要里程碑：上線評估會議').waitFor({ timeout: 15000 });
  await schedulePanel.locator('li.schedule-milestone').getByText('待達成').waitFor({ timeout: 15000 });
  await schedulePanel.getByText('最新目標 2026-10-15').waitFor({ timeout: 15000 });
  const initialMilestoneText = await schedulePanel.locator('li.schedule-milestone').textContent();
  assert.ok(!initialMilestoneText.includes('–'), 'milestone list must not display date range');

  // 改期：最新目標延至 2026-10-18，原始目標維持 2026-10-15，偏差 +3 天
  await schedulePanel.locator('li.schedule-milestone').getByRole('button', { name: '編輯' }).click();
  await schedulePanel.getByLabel('最新目標').fill('2026-10-18');
  await schedulePanel.getByLabel('修改原因', { exact: true }).fill('依據架構審查結論調整');
  await schedulePanel.getByRole('button', { name: '儲存時程' }).click();
  await schedulePanel.getByRole('heading', { name: '新增交付項目' }).waitFor({ timeout: 15000 });
  await schedulePanel.locator('li.schedule-milestone').getByText('偏差 +3 天').waitFor({ timeout: 15000 });

  // 建立前置關係 (Issue #4)：將「驗收階段」設為「上線評估會議」的前置項目
  await schedulePanel.locator('li.schedule-milestone').getByRole('button', { name: '編輯' }).click();
  await schedulePanel.getByRole('heading', { name: '前置項目管理' }).waitFor({ timeout: 15000 });
  await schedulePanel.getByLabel('選擇前置項目').selectOption({ label: '[階段] 驗收階段' });
  await schedulePanel.getByPlaceholder('例如：需待架構確認後方可進行').fill('需待驗收階段簽署完成');
  await schedulePanel.getByRole('button', { name: '建立前置關聯' }).click();
  await page.getByText('已建立前置關聯。').waitFor({ timeout: 15000 });
  await schedulePanel.locator('li.schedule-milestone').getByText('前置：驗收階段').waitFor({ timeout: 15000 });

  // 驗證順序衝突警示：當前置完成日 (2026-10-10) 晚於最新目標 (設為 2026-10-08)
  await schedulePanel.getByLabel('最新目標').fill('2026-10-08');
  await schedulePanel.getByLabel('修改原因', { exact: true }).fill('嘗試提前時程測試衝突');
  await schedulePanel.getByRole('button', { name: '儲存時程' }).click();
  await schedulePanel.getByRole('heading', { name: '新增交付項目' }).waitFor({ timeout: 15000 });
  await schedulePanel.locator('li.schedule-milestone').getByText('順序衝突').waitFor({ timeout: 15000 });
  await schedulePanel.locator('.gantt-row').getByText('⚠️').waitFor({ timeout: 15000 });

  // 恢復目標為 2026-10-18，解除順序衝突
  await schedulePanel.locator('li.schedule-milestone').getByRole('button', { name: '編輯' }).click();
  await schedulePanel.getByLabel('最新目標').fill('2026-10-18');
  await schedulePanel.getByLabel('修改原因', { exact: true }).fill('改期至可行日期');
  await schedulePanel.getByRole('button', { name: '儲存時程' }).click();
  await schedulePanel.getByRole('heading', { name: '新增交付項目' }).waitFor({ timeout: 15000 });
  assert.equal(await schedulePanel.locator('li.schedule-milestone').getByText('順序衝突').count(), 0);


  // 達成：標記已達成，未填實際達成日不可儲存，填妥後儲存
  await schedulePanel.locator('li.schedule-milestone').getByRole('button', { name: '編輯' }).click();
  await schedulePanel.getByLabel('狀態').selectOption('achieved');
  assert.equal(await schedulePanel.getByRole('button', { name: '儲存時程' }).isDisabled(), true, 'achieved milestone requires actualDate');
  await schedulePanel.getByLabel('實際達成日').fill('2026-10-17');
  await schedulePanel.getByLabel('修改原因', { exact: true }).fill('提早完成上線評估');
  await schedulePanel.getByRole('button', { name: '儲存時程' }).click();
  await schedulePanel.getByRole('heading', { name: '新增交付項目' }).waitFor({ timeout: 15000 });
  await schedulePanel.locator('li.schedule-milestone').getByText('已達成').waitFor({ timeout: 15000 });
  await schedulePanel.locator('li.schedule-milestone').getByText('實際達成 2026-10-17').waitFor({ timeout: 15000 });
  await schedulePanel.locator('li.schedule-milestone').getByText('偏差 +2 天').waitFor({ timeout: 15000 });

  // 重開：操作選 reopen，重置為待達成並清除實際達成日
  await schedulePanel.locator('li.schedule-milestone').getByRole('button', { name: '編輯' }).click();
  await schedulePanel.getByLabel('操作').selectOption('reopen');
  await schedulePanel.getByLabel('修改原因', { exact: true }).fill('發現待辦項目需重新評估');
  await schedulePanel.getByRole('button', { name: '儲存時程' }).click();
  await schedulePanel.getByRole('heading', { name: '新增交付項目' }).waitFor({ timeout: 15000 });
  await schedulePanel.locator('li.schedule-milestone').getByText('待達成').waitFor({ timeout: 15000 });
  const reopenedMilestoneText = await schedulePanel.locator('li.schedule-milestone').textContent();
  assert.ok(!reopenedMilestoneText.includes('實際達成'), 'reopened milestone must clear current actualDate');

  // 重新確認達成以利發布
  await schedulePanel.locator('li.schedule-milestone').getByRole('button', { name: '編輯' }).click();
  await schedulePanel.getByLabel('狀態').selectOption('achieved');
  await schedulePanel.getByLabel('實際達成日').fill('2026-10-18');
  await schedulePanel.getByLabel('修改原因', { exact: true }).fill('第二次審查通過達成');
  await schedulePanel.getByRole('button', { name: '儲存時程' }).click();
  await schedulePanel.getByRole('heading', { name: '新增交付項目' }).waitFor({ timeout: 15000 });
  await schedulePanel.locator('li.schedule-milestone').getByText('已達成').waitFor({ timeout: 15000 });

  // Issue #10 驗證：甘特圖里程碑永遠為單日點標記；達成以實際達成日為主要點，無期間條
  const achievedMarker = schedulePanel.locator('.gantt-row:has-text("上線評估會議") .milestone-marker.achieved-marker');
  assert.ok(await achievedMarker.count() > 0, 'achieved milestone must have diamond marker');
  assert.equal(await schedulePanel.locator('.gantt-row:has-text("上線評估會議") .baseline-bar').count(), 0, 'milestone must never have period bars');
  // 驗證點擊甘特圖列進入有原因與歷史的修訂表單（不以拖曳直接改動承諾）
  await schedulePanel.locator('.gantt-row:has-text("上線評估會議")').click();
  await schedulePanel.getByRole('heading', { name: '編輯交付項目' }).waitFor({ timeout: 15000 });
  await schedulePanel.getByRole('button', { name: '取消' }).click();

  // Issue #5: 取消、前置阻礙、重新啟用與關係清理
  // 建立「前置測試任務」與「後續測試任務」
  await schedulePanel.getByLabel('類型').selectOption('task');
  await schedulePanel.getByLabel('名稱').fill('前置測試任務');
  await schedulePanel.getByLabel('負責人或單位').fill('架構組');
  await schedulePanel.getByLabel('原始計畫開始').fill('2026-10-01');
  await schedulePanel.getByLabel('原始計畫結束').fill('2026-10-05');
  await schedulePanel.getByRole('button', { name: '新增時程' }).click();
  await schedulePanel.getByText('關鍵任務：前置測試任務').waitFor({ timeout: 15000 });

  await schedulePanel.getByLabel('類型').selectOption('task');
  await schedulePanel.getByLabel('名稱').fill('後續測試任務');
  await schedulePanel.getByLabel('負責人或單位').fill('開發組');
  await schedulePanel.getByLabel('原始計畫開始').fill('2026-10-06');
  await schedulePanel.getByLabel('原始計畫結束').fill('2026-10-12');
  await schedulePanel.getByRole('button', { name: '新增時程' }).click();
  await schedulePanel.getByText('關鍵任務：後續測試任務').waitFor({ timeout: 15000 });

  // 關聯前置測試任務 -> 後續測試任務
  await schedulePanel.locator('li.schedule-task:has(strong:has-text("關鍵任務：後續測試任務"))').getByRole('button', { name: '編輯' }).click();
  await schedulePanel.getByLabel('選擇前置項目').selectOption({ label: '[任務] 前置測試任務' });
  await schedulePanel.getByPlaceholder('例如：需待架構確認後方可進行').fill('需待前置測試任務交付');
  await schedulePanel.getByRole('button', { name: '建立前置關聯' }).click();
  await page.getByText('已建立前置關聯。').waitFor({ timeout: 15000 });

  // 嘗試取消前置測試任務：因有後續任務，阻擋取消並禁用按鈕
  await schedulePanel.locator('li.schedule-task:has(strong:has-text("關鍵任務：前置測試任務"))').getByRole('button', { name: '編輯' }).click();
  await schedulePanel.getByLabel('操作').selectOption('cancel');
  await schedulePanel.locator('.cancellation-blocker-alert').waitFor({ timeout: 15000 });
  assert.ok(await schedulePanel.getByText('無法直接取消項目').count() > 0);
  assert.equal(await schedulePanel.getByRole('button', { name: '儲存時程' }).isDisabled(), true, 'cancellation with active successors must be disabled');

  // 解除後續任務之前置關聯
  await schedulePanel.locator('li.schedule-task:has(strong:has-text("關鍵任務：後續測試任務"))').getByRole('button', { name: '編輯' }).click();
  page.once('dialog', dialog => dialog.accept('解除測試相依'));
  await schedulePanel.getByRole('button', { name: '解除關聯' }).click();
  await page.getByText('已解除前置關聯。').waitFor({ timeout: 15000 });

  // 成功取消前置測試任務
  await schedulePanel.locator('li.schedule-task:has(strong:has-text("關鍵任務：前置測試任務"))').getByRole('button', { name: '編輯' }).click();
  await schedulePanel.getByLabel('操作').selectOption('cancel');
  await schedulePanel.locator('.cancellation-ready-notice').waitFor({ timeout: 15000 });
  await schedulePanel.getByLabel('修改原因', { exact: true }).fill('架構調整取消此任務');
  await schedulePanel.getByRole('button', { name: '儲存時程' }).click();
  await page.getByText('已儲存結構化時程。').waitFor({ timeout: 15000 });

  // 驗證主時程清單已不包含取消項目
  assert.equal(await schedulePanel.locator('ul > li.schedule-task:has(strong:has-text("關鍵任務：前置測試任務"))').count(), 0);

  // Issue #10 驗證：甘特圖取消項目預設隱藏且有明確入口可檢視，不因實際日期推測完成狀態
  assert.equal(await schedulePanel.locator('.gantt-row.gantt-row-cancelled').count(), 0, 'cancelled items must be hidden by default in gantt');
  await schedulePanel.locator('.btn-gantt-toggle-cancelled').click();
  const cancelledGanttRow = schedulePanel.locator('.gantt-row-cancelled:has-text("前置測試任務")');
  await cancelledGanttRow.waitFor({ timeout: 15000 });
  assert.ok(await cancelledGanttRow.getByText('取消').count() > 0, 'cancelled gantt row must display cancelled state pill');
  await schedulePanel.locator('.btn-gantt-toggle-cancelled').click();
  assert.equal(await schedulePanel.locator('.gantt-row.gantt-row-cancelled').count(), 0, 'cancelled items collapsed in gantt');

  // 展開已取消項目區塊並檢查
  await schedulePanel.locator('.cancelled-summary').click();
  await schedulePanel.locator('.cancelled-item:has-text("前置測試任務")').waitFor({ timeout: 15000 });
  assert.ok(await schedulePanel.locator('.cancelled-item:has-text("前置測試任務")').getByText('已取消').count() > 0);

  // 重新啟用前置測試任務
  await schedulePanel.locator('.cancelled-item:has-text("前置測試任務")').getByRole('button', { name: '重新啟用' }).click();
  await schedulePanel.locator('.reactivate-notice').waitFor({ timeout: 15000 });
  await schedulePanel.getByLabel('修改原因', { exact: true }).fill('重新評估後決定恢復');
  await schedulePanel.getByRole('button', { name: '儲存時程' }).click();
  await page.getByText('已儲存結構化時程。').waitFor({ timeout: 15000 });
  await schedulePanel.locator('li.schedule-task:has(strong:has-text("關鍵任務：前置測試任務"))').waitFor({ timeout: 15000 });
  assert.ok(await schedulePanel.locator('li.schedule-task:has(strong:has-text("關鍵任務：前置測試任務"))').getByText('開放').count() > 0);

  // Issue #6 畫面驗證：跨部門相依事項管理與關聯提醒
  // 1. 新增跨部門相依事項
  const extSection = page.locator('.external-dependencies-section');
  await extSection.waitFor({ timeout: 15000 });
  await extSection.locator('.btn-toggle-ext-form').click();
  const descInput = extSection.getByPlaceholder('例如：機房伺服器配電施工');
  await descInput.waitFor({ timeout: 15000 });
  await descInput.fill('機房伺服器配電施工');
  await extSection.getByPlaceholder('例如：廠務處 / 資安處').fill('廠務處');
  await extSection.locator('input[type="date"]').fill('2026-10-25');
  await extSection.getByRole('button', { name: '儲存外部相依事項' }).click();
  await page.getByText('已新增跨部門相依事項。').waitFor({ timeout: 15000 });
  assert.ok(await extSection.locator('.external-dep-card:has-text("機房伺服器配電施工")').count() > 0);
  assert.ok(await extSection.getByText('廠務處').count() > 0);

  // 2. 編輯時程項目並關聯該外部相依事項
  const phaseItem = schedulePanel.locator('li:has(strong:has-text("驗收階段"))');
  await phaseItem.getByRole('button', { name: '編輯' }).click();
  const extPanel = schedulePanel.locator('.external-dependency-panel');
  await extPanel.waitFor({ timeout: 15000 });
  await extPanel.locator('select').selectOption({ label: '機房伺服器配電施工（廠務處 · 到期：2026-10-25 · 未交付）' });
  await extPanel.getByPlaceholder('請填寫受此外部交付影響之原因').fill('供電延遲將影響驗收機房進度');
  await extPanel.getByRole('button', { name: '關聯外部相依事項' }).click();
  await page.getByText('已建立跨部門相依關聯。').waitFor({ timeout: 15000 });
  assert.ok(await extPanel.locator('.external-dep-list-item:has-text("機房伺服器配電施工")').count() > 0);

  // 關閉編輯表單並檢視主清單中的外部交付提醒
  await schedulePanel.getByRole('button', { name: '取消' }).click();
  const extNotice = phaseItem.locator('.external-notice-pill');
  await extNotice.waitFor({ timeout: 15000 });
  assert.ok(await extNotice.getByText('外部交付提醒').count() > 0);
  assert.ok(await extNotice.getByText('廠務處').count() > 0);
  assert.ok(await extNotice.getByText('尚未交付').count() > 0);

  // 3. 更新外部相依狀態為已交付
  page.once('dialog', dialog => dialog.accept('廠務確認送電'));
  await extSection.locator('.external-dep-card:has-text("機房伺服器配電施工")').getByRole('button', { name: '標記為已交付 ✓' }).click();
  await page.getByText('跨部門相依事項已變更為「已交付」。').waitFor({ timeout: 15000 });
  assert.equal(await phaseItem.locator('.external-notice-pill').count(), 0, 'delivered external dependency should clear notice');

  // Issue #7 畫面驗證：參與者進度與時程提案（Frontend-Design 驗收）
  const proposalsSection = page.locator('.project-proposals-section');
  await proposalsSection.waitFor({ timeout: 15000 });
  assert.ok(await proposalsSection.getByText('參與者進度與時程提案').count() > 0, 'proposals section header should exist');
  assert.ok(await proposalsSection.locator('.btn-proxy-proposal').count() > 0, 'proxy proposal button should exist for maintainer');

  // 1. 維護人代為記錄無帳號外部負責人進度提案
  await proposalsSection.locator('.btn-proxy-proposal').click();
  const proposalModal = page.locator('.proposal-modal');
  await proposalModal.waitFor({ timeout: 15000 });
  assert.ok(await proposalModal.locator('.modal-proxy-alert').count() > 0, 'proxy alert should be displayed in proxy mode');

  await proposalModal.locator('input[placeholder*="例如：廠商窗口"]').fill('廠商窗口 Email 週報（無帳號外部負責人）');
  await proposalModal.locator('input[type="number"]').fill('75');
  await proposalModal.locator('textarea').fill('完成 75% 介面串接，因硬體到貨順延 2 天');
  await proposalModal.locator('input[type="date"]').last().fill('2026-10-22');
  await proposalModal.getByRole('button', { name: '確認送出提案' }).click();

  await page.getByText('已送出工作進度與時程提案。').waitFor({ timeout: 15000 });
  const pendingCard = proposalsSection.locator('.proposal-card:has-text("廠商窗口 Email 週報")');
  await pendingCard.waitFor({ timeout: 15000 });
  assert.ok(await pendingCard.getByText('⏳ 待審核').count() > 0, 'new proposal should have pending badge');
  assert.ok(await pendingCard.getByText('75%').count() > 0, 'proposal card should display progress percentage');
  assert.ok(await pendingCard.getByText('完成 75% 介面串接').count() > 0, 'proposal card should display description');

  // 2. 維護人採納提案（走租約、版本、原因流程）
  await pendingCard.locator('.btn-accept-proposal').click();
  const acceptModal = page.locator('.proposal-modal');
  await acceptModal.waitFor({ timeout: 15000 });
  assert.ok(await acceptModal.getByText('✓ 採納時程提案並更新專案排程').count() > 0);
  await acceptModal.locator('textarea').fill('經評估硬體到貨狀況，同意順延交付日期');
  await acceptModal.locator('.btn-success').click();

  await page.getByText('已採納提案並更新關鍵任務時程。').waitFor({ timeout: 15000 });
  assert.ok(await pendingCard.getByText('✓ 已採納').count() > 0, 'proposal badge should transition to accepted');
  assert.ok(await pendingCard.getByText('經評估硬體到貨狀況').count() > 0, 'decision note should be displayed');

  // Issue #11 畫面驗證：手動連結 eCIM 工作證據（來源挑選、手動連結、比對展開、發布快照）
  const taskToEvidence = schedulePanel.locator('li.schedule-task:has(strong:has-text("關鍵任務：交付檢核"))');
  await taskToEvidence.getByRole('button', { name: '編輯' }).click();
  const evPanel = schedulePanel.locator('.ecim-evidence-panel');
  await evPanel.waitFor({ timeout: 15000 });
  assert.ok(await evPanel.getByText('📎 eCIM 工作證據連結').count() > 0, 'evidence panel header should exist');

  // 手動輸入或挑選候選 eCIM 來源
  await evPanel.locator('.evidence-add-box input').first().fill('ecim-ok-work-1');
  await evPanel.locator('.evidence-add-box input[placeholder="佐證工作摘要或說明"]').fill('課別工程師上線前檢測報告');
  await evPanel.locator('.evidence-add-box input[placeholder*="為何此 eCIM 工作作為"]').fill('以工程師實際提交之 eCIM 工作單佐證檢核進展');
  await evPanel.locator('.btn-add-evidence-link').click();

  await page.getByText('已成功連結 eCIM 工作證據。').waitFor({ timeout: 15000 });
  assert.ok(await evPanel.locator('.evidence-list-item:has-text("ecim-ok-work-1")').count() > 0, 'evidence item should appear in list');

  // 取消編輯表單，驗證甘特圖與項目清單具備證據徽章
  await schedulePanel.getByRole('button', { name: '取消' }).click();
  await schedulePanel.locator('.btn-gantt-toggle-tasks').click();
  assert.ok(await schedulePanel.locator('.gantt-evidence-chip').count() > 0, 'gantt evidence chip should be visible on task row');
  await schedulePanel.locator('.btn-gantt-toggle-tasks').click();

  // 再次取消前置測試任務以驗收正式發布頁面之已取消區塊
  await schedulePanel.locator('li.schedule-task:has(strong:has-text("關鍵任務：前置測試任務"))').getByRole('button', { name: '編輯' }).click();
  await schedulePanel.getByLabel('操作').selectOption('cancel');
  await schedulePanel.getByLabel('修改原因', { exact: true }).fill('確認本期不交付');
  await schedulePanel.getByRole('button', { name: '儲存時程' }).click();
  await page.getByText('已儲存結構化時程。').waitFor({ timeout: 15000 });

  await page.getByRole('button', { name: '發布正式版' }).click();
  const publication = page.getByRole('link', { name: '查看剛發布的固定版本' });
  await publication.waitFor({ timeout: 15000 });
  const publicationHref = await publication.getAttribute('href');
  await publication.click();
  await page.getByRole('heading', { name: '正式處會週報' }).waitFor({ timeout: 15000 });
  await page.getByText('版本 1').waitFor({ timeout: 15000 });
  await page.getByRole('heading', { name: '來源狀態' }).waitFor({ timeout: 15000 });
  assert.equal(await page.getByText('尚未接入來源').count(), 3);
  await page.getByText('這是投影與列印驗收用的代表性長文字', { exact: false }).first().waitFor({ timeout: 15000 });
  assert.equal(await page.getByRole('heading', { name: '專案摘要', exact: true }).count(), 1);
  assert.equal(await page.getByRole('heading', { name: '專案摘要（二）', exact: true }).count(), 1);
  await page.getByText('重要里程碑：上線評估會議').waitFor({ timeout: 15000 });
  assert.ok(await page.locator('.milestone-marker').count() > 0, 'milestone diamond marker should be rendered in publication gantt');
  const pubMilestoneText = await page.locator('li.schedule-milestone').first().textContent();
  assert.ok(!pubMilestoneText.includes('–'), 'publication milestone must not display date range');
  assert.ok(pubMilestoneText.includes('實際達成 2026-10-18'), 'publication milestone should display actual date');
  assert.ok(pubMilestoneText.includes('前置：驗收階段'), 'publication milestone should display predecessor chip');
  assert.ok(await page.locator('.continuity-badge').count() > 0, 'continuity badge should be displayed on published schedule entries');
  assert.equal(await page.getByRole('heading', { name: '交接維運系統', exact: true }).count(), 1);
  assert.equal(await page.getByText('完成簽收').waitFor({ timeout: 15000 }), undefined);
  assert.ok(await page.locator('.publication-cancelled-section').count() > 0, 'cancelled section should exist in publication');
  assert.ok(await page.locator('.publication-cancelled-list').getByText('前置測試任務').count() > 0, 'cancelled item should appear in publication cancelled list');

  // Issue #10 驗證：正式發布頁甘特圖具備任務展開、取消項目檢視與修訂歷史入口
  assert.equal(await page.locator('.gantt .gantt-row.gantt-row-task').count(), 0, 'publication gantt tasks collapsed by default');
  await page.locator('.gantt .btn-gantt-toggle-tasks').first().click();
  assert.ok(await page.locator('.gantt .gantt-row-task').count() > 0, 'publication gantt key tasks expanded on demand');
  assert.ok(await page.locator('.gantt .gantt-row-task .gantt-evidence-chip').count() > 0, 'publication gantt should render evidence chip');
  await page.locator('.gantt .btn-gantt-toggle-cancelled').first().click();
  assert.ok(await page.locator('.gantt .gantt-row-cancelled').count() > 0, 'publication gantt cancelled items visible on demand');

  // Issue #11 驗證：正式發布頁包含 eCIM 佐證快照，點擊可開啟佐證詳情快照彈窗
  const pubEvPill = page.locator('.pub-evidence-pill:has-text("ecim-ok-work-1")').first();
  await pubEvPill.waitFor({ timeout: 15000 });
  await pubEvPill.click();
  await page.locator('.history-modal').waitFor({ timeout: 15000 });
  assert.ok(await page.getByText('eCIM 工作佐證快照').count() > 0, 'evidence modal should open and display title');
  assert.ok(await page.getByText('ecim-ok-work-1').count() > 0, 'evidence modal should show workId');
  await page.locator('.history-modal-footer .btn-ghost').click();

  // Verify Publication Revision History Inspector (Issue #8)
  const inspectBtn = page.locator('li.schedule-milestone .btn-history-inspect').first();
  await inspectBtn.waitFor({ timeout: 15000 });
  await inspectBtn.click();
  await page.locator('.history-modal').waitFor({ timeout: 15000 });
  assert.ok(await page.getByText('時程修訂歷程').count() > 0, 'history modal should open and display title');
  assert.ok(await page.locator('.history-timeline-entry').count() > 0, 'history timeline should show entries');
  await page.locator('.history-modal-footer .btn-ghost').click();
  await page.getByRole('link', { name: '來源' }).waitFor({ timeout: 15000 });
  await page.getByText('確認負責人', { exact: false }).waitFor({ timeout: 15000 });
  assert.match(page.url(), new RegExp(`#/publications/`));
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('header a').evaluate(element => getComputedStyle(element).display), 'none');
  assert.equal(await page.locator('.btn-history-inspect').first().evaluate(element => getComputedStyle(element).display), 'none');
  assert.equal(await page.locator('nav').count(), 0);
  assert.equal(await page.locator('.publication article').first().evaluate(element => getComputedStyle(element).breakInside), 'avoid');
  const pdf = await page.pdf({ format: 'A4', printBackground: true });
  assert.ok(pdf.length > 1000, 'print PDF should contain the representative publication');
  await page.emulateMedia({ media: 'screen' });

  // 驗證新週時程延續工作畫面 (Issue #9)
  await page.goto(`${webOrigin}/#/`);
  await page.locator('input[type="date"]').fill('2026-10-08');
  await page.getByRole('button', { name: '建立或開啟週報' }).click();
  await page.waitForURL(/.*#\/reports\/.+/);
  await page.getByRole('heading', { name: '處會週報' }).waitFor({ timeout: 15000 });
  const carriedItemBtn = page.getByRole('button', { name: '專案摘要', exact: true });
  await carriedItemBtn.waitFor({ timeout: 15000 });
  await carriedItemBtn.click();
  const newWeekSchedulePanel = page.locator('.project-schedule');
  await newWeekSchedulePanel.waitFor({ timeout: 15000 });
  await newWeekSchedulePanel.locator('.schedule-continuation-banner').waitFor({ timeout: 15000 });
  assert.ok(await newWeekSchedulePanel.locator('.schedule-continuation-banner').count() > 0, 'continuation banner should show on carried project schedule');
  await newWeekSchedulePanel.locator('.continuity-badge').first().waitFor({ timeout: 15000 });
  assert.ok(await newWeekSchedulePanel.locator('.continuity-badge').count() > 0, 'continuity badges should show on carried schedule entries');
  assert.ok(await newWeekSchedulePanel.locator('.cancelled-section').count() > 0, 'cancelled section should remain hidden by default in new week');
  assert.equal(await newWeekSchedulePanel.locator('ul.cancelled-list').isVisible(), false, 'cancelled items should be collapsed by default');
  runtimeConfig = { ...runtimeConfig, apiBaseUrl: '' };
  await page.goto(`${base}/${publicationHref}`);
  await page.getByRole('heading', { name: '正式處會週報' }).waitFor({ timeout: 15000 });
  runtimeConfig = { ...runtimeConfig, apiBaseUrl: '/\\evil.test' };
  const refreshCount = refreshCalls.length;
  await page.reload();
  await page.getByRole('alert').getByText(/apiBaseUrl must not contain a backslash/).waitFor({ timeout: 15000 });
  assert.equal(refreshCalls.length, refreshCount, 'invalid config must stop before login');
  console.log('Browser smoke passed: SSO return, item commit, publication, and print layout');
} finally {
  await browser?.close();
  if (webServer) await new Promise(resolve => webServer.close(resolve));
  api.kill();
  if (api.exitCode === null) await once(api, 'exit');
  jwks.close();
  await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
