import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as createTcpServer } from 'node:net';
import { generateKeyPairSync, sign } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || pathToFileURL(join(root, 'apps/web/node_modules/playwright/index.mjs')).href);
const shots = process.env.SMOKE_SCREENSHOTS || join(root, 'tests/screenshots');
mkdirSync(shots, { recursive: true });
const shot = (p, name) => p.screenshot({ path: join(shots, `${name}.png`), fullPage: true });
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
  await page.clock.setFixedTime('2026-10-12T09:00:00');
  await page.goto(url);
  const s1 = page.locator('[data-file="s1"]');
  await s1.locator('[data-add-project]').waitFor({ timeout: 15000 });
  // head lands on own section's projects tab; rail/tab semantics and read-only marks
  await page.waitForURL(/#\/weeks\/2026-W41\/s1\/projects$/);
  assert.equal(await page.locator('[data-rail-file="s1"]').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('[data-tab="projects"]').getAttribute('aria-selected'), 'true');
  assert.equal(await page.locator('[data-rail-file="s1"] .ro').count(), 0);
  for (const f of ['s2', 's3', 'cross']) assert.equal(await page.locator(`[data-rail-file="${f}"] .ro`).innerText(), '唯讀', f);
  assert.equal(await page.locator('[data-readonly-note]').count(), 0);
  // empty project list: dashed guidance for an editor, plain note for read-only viewers
  assert.match(await s1.locator('[data-empty]').innerText(), /新增專案/);
  await shot(page, '01-editor-empty');
  assert.equal(await page.locator('[data-shell]').count(), 1);
  assert.match(await page.locator('[data-shell] .who').innerText(), /Head One\s*課長/);
  await s1.locator('[data-add-project]').click();
  assert.equal(await s1.locator('[data-empty]').count(), 0);
  const project = s1.locator('app-project-schedule').last();
  await project.locator('[data-field="project-title"]').fill('新平台');
  await project.locator('[data-field="project-owner"]').fill('王小明');
  // date pickers open on the month of today (fixed 2026-10) or of the current start; all dates here are in October
  const pickRange = async (loc, a, b) => { await loc.locator('.drp-trigger').click(); await loc.locator(`[data-date="${a}"]`).click(); if (b) await loc.locator(`[data-date="${b}"]`).click(); };
  const setPre = async (entry, names) => {
    const sel = project.locator(`[data-entry="${entry}"] [data-field="predecessors"]`);
    await sel.locator('.pre-trigger').click();
    await sel.locator('.pre-clear-btn').click();
    for (const n of names) await sel.locator('.pre-option', { hasText: n }).locator('input').check();
    await page.keyboard.press('Escape');
  };
  const addEntry = async (kind, name) => {
    await project.locator(`[data-add-entry="${kind}"]`).click();
    await project.locator('[data-field="entry-name"]').last().fill(name);
  };
  await addEntry('phase', '設計階段');
  await pickRange(project.locator('[data-field="planRange"]').last(), '2026-10-01', '2026-10-20');
  await pickRange(project.locator('[data-field="actualRange"]').last(), '2026-10-01', '2026-10-22');
  await addEntry('task', '撰寫規格');
  await project.locator('[data-entry="撰寫規格"] select').first().selectOption({ label: '設計階段' });
  await pickRange(project.locator('[data-field="planRange"]').last(), '2026-10-02', '2026-10-10');
  await addEntry('milestone', '上線');
  await pickRange(project.locator('[data-field="planDate"]').last(), '2026-10-30');
  await pickRange(project.locator('[data-field="actualDate"]').last(), '2026-10-31');
  // phase <- direct child link is rejected, and save is blocked
  await setPre('撰寫規格', ['設計階段']);
  await project.getByRole('alert').first().waitFor({ timeout: 5000 });
  await page.locator('[data-save]').click();
  await page.locator('[data-save-bar] [role="alert"]', { hasText: /時程有誤，未儲存/ }).waitFor({ timeout: 5000 });
  assert.equal(await page.locator('[data-project-error]').count(), 1);
  assert.equal(await page.locator('[data-rail-file="s1"] [data-dirty]').count(), 1);
  // valid link: milestone after task
  await setPre('撰寫規格', []);
  await setPre('上線', ['撰寫規格']);
  // pick an engineer work item with a summary, plus a manual one
  await project.locator('[data-entry="撰寫規格"] [data-evidence-toggle]').click();
  await project.locator('[data-work="101"] [data-pick]').click();
  await project.locator('[data-field="evidence-summary"]').last().fill('管線已上線');
  await project.locator('[data-field="manual-work-id"]').fill('555');
  await project.locator('[data-manual-add]').click();
  await project.locator('[data-field="evidence-summary"]').last().fill('手動補充');
  // external deliveries: add two, delete one, fill the other
  await project.locator('[data-deliveries] summary').click();
  await project.locator('[data-add-dependency]').click();
  await project.locator('[data-add-dependency]').click();
  assert.match(await project.locator('[data-deliveries] summary').innerText(), /外部交付（2 項）/);
  await project.locator('[data-dependency]').first().locator('[data-remove-dependency]').click();
  const dep = project.locator('[data-dependency]');
  assert.equal(await dep.count(), 1);
  await dep.locator('[data-field="dep-description"]').fill('伺服器採購');
  await dep.locator('[data-field="dep-supplier"]').fill('資訊採購組');
  await dep.locator('[data-field="dep-due"]').fill('2026-10-15');
  await dep.locator('[data-field="dep-status"]').selectOption('delivered');
  await dep.locator('[data-field="dep-links"]').selectOption({ label: '撰寫規格' });
  await page.locator('[data-save]').click();
  await page.getByText('已儲存第一課').waitFor({ timeout: 15000 });
  assert.equal(await page.locator('[data-dirty]').count(), 0);
  assert.equal(await page.locator('[data-save-bar] [role="alert"]').count(), 0);
  assert.equal(await page.locator('[data-save-state]').innerText(), '所有變更已儲存');

  await page.reload();
  await page.locator('[data-save-state="clean"]').waitFor({ timeout: 15000 });
  assert.equal(await page.locator('[data-dirty]').count(), 0);
  assert.equal(await page.locator('[data-save]').isDisabled(), true);
  const again = page.locator('[data-file="s1"] app-project-schedule').last();
  await again.locator('.gantt-row').first().waitFor({ timeout: 15000 });
  assert.equal(await again.locator('[data-field="project-title"]').inputValue(), '新平台');
  assert.equal(await again.locator('.gantt-row-phase').count(), 1);
  assert.equal(await again.locator('.gantt-row-milestone').count(), 1);
  assert.equal(await again.locator('.gantt-row-phase .plan-bar').count(), 1);
  assert.equal(await again.locator('.gantt-row-phase .actual-bar').count(), 1);
  assert.equal(await again.locator('.gantt-row-phase .gantt-variance-badge').innerText(), '+2 天');
  assert.equal(await again.locator('.gantt-row-milestone .milestone-target-marker').count(), 1);
  assert.equal(await again.locator('.gantt-row-milestone .achieved-marker').count(), 1);
  assert.equal(await again.locator('.gantt-row-milestone .gantt-variance-badge').innerText(), '+1 天');
  const saved = (await (await fetch(base + '/api/weeks/2026-W41', { headers: { Authorization: `Bearer ${jwt}` } })).json()).s1.items.find(i => i.title === '新平台');
  assert.deepEqual(saved.schedule.find(e => e.name === '上線').predecessors, [saved.schedule.find(e => e.name === '撰寫規格').id]);
  for (const k of ['successors', 'warnings', 'externalNotices', 'history', 'version', 'continuityId']) assert.ok(saved.schedule.every(e => !(k in e)), k);
  assert.deepEqual(saved.schedule.find(e => e.name === '撰寫規格').evidenceLinks, [{ workId: 101, summary: '管線已上線' }, { workId: 555, summary: '手動補充' }]);
  assert.deepEqual(saved.externalDependencies.map(({ id, ...d }) => d), [{ description: '伺服器採購', supplier: '資訊採購組', dueDate: '2026-10-15', status: 'delivered', linkedEntryIds: [saved.schedule.find(e => e.name === '撰寫規格').id] }]);
  await again.locator('[data-deliveries] summary').click();
  assert.equal(await again.locator('[data-dependency] [data-field="dep-description"]').inputValue(), '伺服器採購');
  assert.equal(await again.locator('[data-dependency] [data-field="dep-status"]').inputValue(), 'delivered');
  // reference links on a non-project item: blank-url rows are not saved; survives reload
  await page.locator('[data-tab="personnel"]').click();
  await page.locator('[data-file="s1"] [data-add="personnel"]').click();
  const card = page.locator('[data-file="s1"] .item').last();
  await card.locator('[data-field="title"]').fill('人員異動');
  await card.locator('[data-add-ref-link]').click();
  await card.locator('[data-field="ref-label"]').last().fill('空網址');
  await card.locator('[data-add-ref-link]').click();
  await card.locator('[data-field="ref-label"]').last().fill('公告');
  await card.locator('[data-field="ref-url"]').last().fill('https://example.com/notice');
  await page.locator('[data-save]').click();
  await page.getByText('已儲存第一課').waitFor({ timeout: 15000 });
  assert.equal(await card.locator('[data-link-row]').count(), 1);
  const personnel = (await (await fetch(base + '/api/weeks/2026-W41', { headers: { Authorization: `Bearer ${jwt}` } })).json()).s1.items.find(i => i.title === '人員異動');
  assert.deepEqual(personnel.details.sourceLinks, [{ label: '公告', url: 'https://example.com/notice' }]);
  await page.reload();
  await card.locator('[data-link-row] [data-field="ref-url"]').waitFor({ timeout: 15000 });
  assert.equal(await card.locator('[data-link-row] [data-field="ref-url"]').inputValue(), 'https://example.com/notice');
  await card.locator('[data-remove-ref-link]').click();
  assert.equal(await card.locator('[data-link-row]').count(), 0);
  await page.locator('[data-save]').click();
  await page.locator('[data-save-state="clean"]').waitFor({ timeout: 15000 });
  await page.locator('[data-tab="projects"]').click();
  await again.locator('.gantt-row').first().waitFor({ timeout: 15000 });
  await shot(page, '02-editor-project');
  assert.match(await again.locator('.gantt-evidence-chip').innerText(), /2/);
  // health pill (today fixed at 2026-10-12): task past its plan end is overdue; finishing it late turns it into a slip
  assert.match(await again.locator('[data-health]').innerText(), /逾期 1 項\s*完成 0\/2/);
  await pickRange(again.locator('[data-entry="撰寫規格"] [data-field="actualRange"]'), '2026-10-12', '2026-10-12');
  assert.match(await again.locator('[data-health]').innerText(), /曾延後 3 項/);
  // progress: open reads 0%; in-progress starts blank ("—"), only then is the input available, and the header follows the phase
  const spec = again.locator('[data-entry="撰寫規格"]');
  assert.match(await again.locator('[data-overall-progress]').innerText(), /整體進度 0%/);
  assert.equal(await spec.locator('[data-field="entry-progress"]').count(), 0);
  await spec.locator('select').nth(1).selectOption('in-progress');
  assert.equal(await spec.locator('[data-field="entry-progress"]').inputValue(), '');
  assert.match(await again.locator('.gantt-row-task .gantt-progress').innerText(), /—/);
  await spec.locator('[data-field="entry-progress"]').fill('40');
  assert.match(await again.locator('[data-overall-progress]').innerText(), /整體進度 40%/);
  assert.match(await again.locator('.gantt-row-task .gantt-progress').innerText(), /40%/);
  await spec.locator('select').nth(1).selectOption('open');
  assert.equal(await spec.locator('[data-field="entry-progress"]').count(), 0);
  // schedule grid: gantt sits above it, it scrolls on its own with a sticky header, phases open by default and share state with the gantt
  const grid = again.locator('[data-schedule-grid]');
  const ganttBox = await again.locator('.gantt').boundingBox();
  assert.ok(ganttBox.y + ganttBox.height <= (await grid.boundingBox()).y, 'gantt above grid');
  assert.deepEqual(await grid.locator('thead th').allInnerTexts(), ['類型', '名稱', '負責', '狀態', '進度', '計畫起訖', '實際起訖', '前置項目', '操作']);
  assert.deepEqual(await grid.locator('tbody tr[data-entry]').evaluateAll(rs => rs.map(r => r.dataset.entry)), ['設計階段', '撰寫規格', '上線']);
  const scroll = await grid.evaluate(el => ({ overflow: getComputedStyle(el).overflow, max: getComputedStyle(el).maxHeight, th: getComputedStyle(el.querySelector('th')).position, wide: getComputedStyle(el).overflowX }));
  assert.deepEqual([scroll.overflow, scroll.th, scroll.wide], ['auto', 'sticky', 'auto']);
  assert.ok(parseFloat(scroll.max) <= page.viewportSize().height / 2 + 1, 'max height about half the viewport');
  await grid.locator('.grid-phase-toggle').click();
  assert.equal(await grid.locator('tbody tr[data-entry]').count(), 2, 'collapsed phase hides its tasks in the grid');
  assert.equal(await again.locator('.gantt-row-task').count(), 0, 'and in the gantt');
  await again.locator('.gantt .btn-phase-expand').click();
  assert.equal(await grid.locator('tbody tr[data-entry]').count(), 3, 'gantt arrow reopens the grid');
  // picking a plan range redraws the gantt bar at once
  const phasePlan = again.locator('.gantt-row-phase .plan-bar');
  const barBefore = await phasePlan.getAttribute('style');
  await pickRange(again.locator('[data-entry="設計階段"] [data-field="planRange"]'), '2026-10-01', '2026-10-27');
  assert.notEqual(await phasePlan.getAttribute('style'), barBefore);
  assert.equal(await again.locator('[data-entry="設計階段"] [data-field="planRange"] .drp-display-text').innerText(), '2026-10-01 ～ 2026-10-27');
  // range picker: Enter opens, hint follows the first click, Esc closes and returns focus to the trigger
  const rangeBox = again.locator('[data-entry="撰寫規格"] [data-field="planRange"]');
  const rangeTrigger = rangeBox.locator('.drp-trigger');
  await rangeTrigger.focus();
  await page.keyboard.press('Enter');
  assert.equal(await rangeTrigger.getAttribute('aria-expanded'), 'true');
  assert.equal(await rangeBox.locator('.drp-popup').getAttribute('aria-label'), '計畫起訖');
  await rangeBox.locator('[data-date="2026-10-05"]').click();
  assert.match(await rangeBox.locator('.drp-hint').innerText(), /請點選迄日/);
  assert.equal(await rangeBox.locator('[data-date="2026-10-05"]').getAttribute('aria-pressed'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await rangeBox.locator('.drp-popup').count(), 0);
  assert.equal(await rangeTrigger.getAttribute('aria-expanded'), 'false');
  assert.ok(await rangeTrigger.evaluate(el => el === document.activeElement), 'Esc returns focus to the date trigger');
  assert.equal(await rangeBox.locator('.drp-display-text').innerText(), '2026-10-02 ～ 2026-10-10', 'aborted pick leaves the value alone');
  // finishing a pick closes the popup and keeps focus on the trigger; tabbing away closes it too
  await page.keyboard.press('Enter');
  await rangeBox.locator('[data-date="2026-10-06"]').click();
  await rangeBox.locator('[data-date="2026-10-09"]').click();
  assert.equal(await rangeBox.locator('.drp-popup').count(), 0);
  assert.ok(await rangeTrigger.evaluate(el => el === document.activeElement), 'completed pick returns focus to the date trigger');
  assert.equal(await rangeBox.locator('.drp-display-text').innerText(), '2026-10-06 ～ 2026-10-09');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await rangeBox.locator('.drp-popup').count(), 0, 'focus leaving closes the popup');
  // predecessor select: checking adds a pill, the dependency shows in the entry, Esc closes and returns focus
  const preBox = again.locator('[data-entry="上線"] [data-field="predecessors"]');
  const preTrigger = preBox.locator('.pre-trigger');
  await preTrigger.focus();
  await page.keyboard.press('Enter');
  assert.equal(await preTrigger.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(await preBox.locator('.pre-option', { hasText: '撰寫規格' }).locator('input').isChecked(), true);
  assert.equal(await preBox.locator('.pre-option', { hasText: '設計階段' }).locator('input').isChecked(), false);
  await preBox.locator('.pre-option', { hasText: '設計階段' }).locator('input').check();
  assert.equal(await preBox.locator('.pre-pill').count(), 2);
  await preBox.locator('.pre-option', { hasText: '設計階段' }).locator('input').uncheck();
  assert.deepEqual(await preBox.locator('.pre-pill').allInnerTexts(), ['撰寫規格']);
  await page.keyboard.press('Escape');
  assert.equal(await preBox.locator('.pre-popup').count(), 0);
  assert.ok(await preTrigger.evaluate(el => el === document.activeElement), 'Esc returns focus to the predecessor trigger');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Shift+Tab');
  assert.equal(await preBox.locator('.pre-popup').count(), 0, 'focus leaving closes the predecessor popup');
  // the edit shows a dirty dot on its rail file and in the save bar
  assert.equal(await page.locator('[data-rail-file="s1"] [data-dirty]').getAttribute('aria-label'), '有未儲存變更');
  assert.equal(await page.locator('[data-rail-file="s2"] [data-dirty]').count(), 0);
  assert.equal(await page.locator('[data-save-state]').innerText(), '● 有未儲存變更');
  // tab counts follow the draft; switching tab keeps the edit; switching rail file keeps a shared tab
  assert.equal(await page.locator('[data-tab="projects"] em').innerText(), '1');
  await page.locator('[data-tab="personnel"]').click();
  await page.waitForURL(/#\/weeks\/2026-W41\/s1\/personnel$/);
  await page.locator('[data-rail-file="s2"]').click();
  await page.waitForURL(/#\/weeks\/2026-W41\/s2\/personnel$/);
  assert.match(await page.locator('[data-readonly-note]').innerText(), /🔒 唯讀.*第二課課長/);
  assert.equal(await page.locator('[data-save]').count(), 0);
  assert.equal(await page.locator('[data-rail-file="s1"] [data-dirty]').count(), 1);
  await shot(page, '03-editor-readonly');
  assert.equal(await page.locator('[data-file="s2"] [data-add="personnel"]').count(), 0);
  assert.equal(await page.locator('[data-file="s2"] [data-add-ref-link]').count(), 0);
  await page.locator('[data-rail-file="s1"]').click();
  await page.locator('[data-tab="projects"]').click();
  assert.equal(await page.locator('[data-file="s1"] [data-field="project-title"]').inputValue(), '新平台');
  assert.equal(await page.locator('[data-file="s1"] [data-entry="撰寫規格"] [data-field="actualRange"] .drp-display-text').innerText(), '2026-10-12 ～ 2026-10-12');
  // leaving the editor with unsaved changes asks first; Esc stays, confirming discards
  await page.locator('[data-nav="home"]').click();
  await page.locator('[data-leave-dialog]').waitFor({ state: 'visible', timeout: 5000 });
  await shot(page, '04-leave-dialog');
  await page.keyboard.press('Escape');
  await page.locator('[data-leave-dialog]').waitFor({ state: 'hidden', timeout: 5000 });
  assert.match(page.url(), /#\/weeks\/2026-W41\/s1\/projects$/);
  assert.equal(await page.locator('[data-rail-file="s1"] [data-dirty]').count(), 1);
  await page.locator('[data-nav="home"]').click();
  await page.locator('[data-leave-confirm]').click();
  await page.waitForURL(/#\/$/, { timeout: 15000 });
  // deep links open the named file and tab; unknown file/tab bounce home with a toast
  await page.goto(base + '/#/weeks/2026-W41/cross/decisions');
  await page.locator('[data-tab="decisions"][aria-selected="true"]').waitFor({ timeout: 15000 });
  assert.equal(await page.locator('[data-rail-file="cross"]').getAttribute('aria-current'), 'page');
  await page.goto(base + '/#/weeks/2026-W41/s9/projects');
  await page.getByText('找不到該課別或頁籤').waitFor({ timeout: 15000 });
  await page.waitForURL(/#\/$/);
  await page.goto(base + '/#/weeks/2026-W41/s1/nope');
  await page.getByText('找不到該課別或頁籤').waitFor({ timeout: 15000 });
  await page.waitForURL(/#\/$/);
  // section head sees cross read-only
  await page.goto(base + '/#/weeks/2026-W41/cross');
  await page.waitForURL(/#\/weeks\/2026-W41\/cross\/summary$/);
  assert.match(await page.locator('[data-readonly-note]').innerText(), /部級主管/);
  assert.equal(await page.locator('[data-save]').count(), 0);
  assert.equal(await page.locator('[data-file="cross"] [data-field="managementSummary"]').isDisabled(), true);
  await shot(page, '05-cross-readonly');
  // read-only empty list says so without offering an add button
  await page.goto(base + '/#/weeks/2026-W41/s3/projects');
  assert.equal(await page.locator('[data-file="s3"] [data-empty]').innerText(), '尚無專案');
  // 860px breakpoint: no horizontal scroll and the rail still switches files
  await page.setViewportSize({ width: 800, height: 900 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), 'no horizontal scroll at 800px');
  await page.locator('[data-toast], .toast').waitFor({ state: 'detached', timeout: 10000 }).catch(() => {});
  await shot(page, '06-narrow');
  await page.locator('[data-rail-file="s2"]').click();
  await page.waitForURL(/#\/weeks\/2026-W41\/s2\/projects$/);
  await page.setViewportSize({ width: 1280, height: 720 });

  // division head edits cross and it persists
  const guyJwt = token('G');
  const guyContext = await browser.newContext();
  await guyContext.route('**/assets/config.json', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ apiBaseUrl: '', uacBaseUrl: 'http://mock-uac.test/auth' }) }));
  await guyContext.route('http://mock-uac.test/auth/**', r => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }, body: JSON.stringify({ token: guyJwt, refreshToken: 'r' }) }));
  const guyPage = await guyContext.newPage();
  await guyPage.clock.setFixedTime('2026-10-12T09:00:00');
  await guyPage.addInitScript(([t]) => { localStorage.setItem('CIM_TK', t); localStorage.setItem('CIM_RTK', 'r'); }, [guyJwt]);
  await guyPage.goto(url);
  await guyPage.waitForURL(/#\/weeks\/2026-W41\/cross\/summary$/);
  const cross = guyPage.locator('[data-file="cross"]');
  await guyPage.locator('[data-save-state="clean"]').waitFor({ timeout: 15000 });
  assert.equal(await guyPage.locator('[data-save]').isDisabled(), true);
  await shot(guyPage, '07-cross-summary');
  await cross.locator('[data-field="managementSummary"]').fill('本週有一項風險。');
  assert.equal(await guyPage.locator('[data-rail-file="cross"] [data-dirty]').count(), 1);
  // Tab from the field reaches the save button
  let reached = false;
  for (let i = 0; i < 40 && !reached; i++) {
    await guyPage.keyboard.press('Tab');
    reached = await guyPage.evaluate(() => document.activeElement?.matches('[data-save]'));
  }
  assert.ok(reached, 'Tab reaches save');
  // a failed save keeps the draft and the dirty dot, and reports in the save bar
  await guyPage.route('**/api/weeks/2026-W41/cross', r => r.request().method() === 'PUT' ? r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }) : r.continue());
  await guyPage.locator('[data-save]').click();
  await guyPage.locator('[data-save-bar] [role="alert"]', { hasText: '儲存失敗：boom' }).waitFor({ timeout: 5000 });
  assert.equal(await guyPage.locator('[data-rail-file="cross"] [data-dirty]').count(), 1);
  assert.equal(await cross.locator('[data-field="managementSummary"]').inputValue(), '本週有一項風險。');
  await guyPage.unroute('**/api/weeks/2026-W41/cross');
  await guyPage.locator('[data-save]').click();
  await guyPage.getByText('已儲存跨課').waitFor({ timeout: 15000 });
  assert.equal(await guyPage.locator('[data-dirty]').count(), 0);
  assert.equal(await guyPage.locator('[data-save-bar] [role="alert"]').count(), 0);
  await cross.locator('[data-field="managementSummary"]').fill('本週有一項風險。 ');
  await cross.locator('[data-field="managementSummary"]').fill('本週有一項風險。');
  assert.equal(await guyPage.locator('[data-save-state]').innerText(), '所有變更已儲存');
  await guyPage.locator('[data-tab="decisions"]').click();
  assert.match(await cross.locator('[data-empty]').innerText(), /新增待決策事項/);
  await shot(guyPage, '08-cross-decisions-empty');
  await cross.locator('[data-add-decision]').click();
  assert.equal(await guyPage.locator('[data-tab="decisions"] em').innerText(), '1');
  await cross.locator('[data-field="decision-description"]').last().fill('是否延後上線');
  await guyPage.locator('[data-save]').click();
  await guyPage.locator('[data-save-state="clean"]').waitFor({ timeout: 15000 });
  await guyPage.locator('[data-rail-file="s1"]').click();
  assert.equal(await guyPage.locator('[data-file="s1"] [data-add-project]').count(), 0);
  await guyPage.goto(url);
  await guyPage.locator('[data-file="cross"] [data-field="managementSummary"]').waitFor({ timeout: 15000 });
  await guyPage.waitForFunction(() => document.querySelector('[data-file="cross"] [data-field="managementSummary"]')?.value === '本週有一項風險。', null, { timeout: 15000 });
  await guyPage.locator('[data-tab="decisions"]').click();
  assert.equal(await guyPage.locator('[data-file="cross"] [data-field="decision-description"]').last().inputValue(), '是否延後上線');

  // section head home: hint without create button; unknown week bounces home with a toast
  await page.goto(base + '/#/');
  await page.locator('[data-role-hint]').waitFor({ timeout: 15000 });
  assert.equal(await page.locator('[data-shell]').count(), 1);
  assert.match(await page.locator('[data-role-hint]').innerText(), /編輯第一課的專案與各分項[\s\S]*其他課與跨課內容唯讀/);
  await shot(page, '09-home-head');
  assert.equal(await page.locator('[data-create-week]').count(), 0);
  await page.goto(base + '/#/weeks/2026-W99');
  await page.getByText('找不到該週').waitFor({ timeout: 15000 });
  await page.waitForURL(/#\/$/, { timeout: 15000 });

  // create next week with no publication yet: empty files; only division head sees the button
  await guyPage.goto(base + '/#/');
  await guyPage.locator('[data-role-hint]').waitFor({ timeout: 15000 });
  assert.match(await guyPage.locator('[data-role-hint]').innerText(), /編輯管理摘要與待決策事項[\s\S]*發布本週正式版[\s\S]*建立下週/);
  assert.match(await guyPage.locator('[data-shell] .who').innerText(), /部級/);
  assert.equal(await guyPage.locator('[data-no-publication]').innerText(), '尚無正式版');
  await shot(guyPage, '10-home-division-empty');
  assert.equal(await guyPage.locator('[data-nav="pub"]').count(), 0);
  assert.deepEqual(await guyPage.locator('[data-week-status]').allInnerTexts(), ['草稿']);
  await guyPage.locator('[data-create-week]').click();
  await guyPage.locator('.weeklist a[href="#/weeks/2026-W42"]').waitFor({ timeout: 15000 });
  const w42 = await (await fetch(base + '/api/weeks/2026-W42', { headers: { Authorization: `Bearer ${jwt}` } })).json();
  assert.deepEqual(w42.s1, { section: 's1', week: '2026-W42' });
  // week pill keeps file and tab; with unsaved changes it asks first
  await guyPage.goto(base + '/#/weeks/2026-W41/cross/summary');
  await guyPage.locator('[data-file="cross"] [data-field="managementSummary"]').waitFor({ timeout: 15000 });
  await guyPage.locator('[data-save-state="clean"]').waitFor({ timeout: 15000 });
  await guyPage.locator('[data-file="cross"] [data-field="managementSummary"]').fill('未儲存的修改');
  await guyPage.locator('[data-week-pill]', { hasText: 'W42' }).click();
  await guyPage.locator('[data-leave-dialog]').waitFor({ state: 'visible', timeout: 5000 });
  await guyPage.keyboard.press('Escape');
  await guyPage.locator('[data-leave-dialog]').waitFor({ state: 'hidden', timeout: 5000 });
  assert.match(guyPage.url(), /#\/weeks\/2026-W41\/cross\/summary$/);
  await guyPage.locator('[data-week-pill]', { hasText: 'W42' }).click();
  await guyPage.locator('[data-leave-confirm]').click();
  await guyPage.waitForURL(/#\/weeks\/2026-W42\/cross\/summary$/, { timeout: 15000 });
  await guyPage.goto(base + '/#/weeks/2026-W41/s2/personnel');
  await guyPage.locator('[data-week-pill]', { hasText: 'W42' }).click();
  await guyPage.waitForURL(/#\/weeks\/2026-W42\/s2\/personnel$/, { timeout: 15000 });
  await guyPage.goto(url);

  // division head publishes and lands on the publication page; section head cannot publish
  assert.equal(await page.locator('[data-publish]').count(), 0);
  // a source link on a retained personnel item shows up in the publication
  const week41 = await call('/api/weeks/2026-W41', 'H1');
  const s1Items = week41.body.s1.items;
  s1Items.find(i => i.id === 's1-hr-1').details.sourceLinks = [{ label: '公告', url: 'https://example.com/notice' }];
  assert.equal((await call('/api/weeks/2026-W41/s1', 'H1', 'PUT', { week: '2026-W41', section: 's1', items: s1Items })).status, 204);
  await guyPage.goto(base + '/#/weeks/2026-W41/cross/summary');
  await guyPage.reload();
  await guyPage.locator('[data-save-state="clean"]').waitFor({ timeout: 15000 });
  // unsaved cross file blocks publishing and says why; reverting the edit re-enables it
  const summary = guyPage.locator('[data-file="cross"] [data-field="managementSummary"]');
  await summary.fill('尚未儲存');
  assert.equal(await guyPage.locator('[data-publish]').isDisabled(), true);
  assert.equal(await guyPage.locator('[data-publish-hint]').innerText(), '請先儲存跨課');
  await summary.fill('本週有一項風險。');
  assert.equal(await guyPage.locator('[data-publish]').isDisabled(), false);
  assert.equal(await guyPage.locator('[data-publish]').innerText(), '發布 2026-W41');
  // confirmation dialog: Esc stays, confirm publishes once even though the request is slow
  let posts = 0;
  await guyPage.route('**/api/weeks/2026-W41/publications', async r => { posts++; await new Promise(x => setTimeout(x, 800)); await r.continue(); });
  await guyPage.locator('[data-publish]').click();
  await guyPage.locator('[data-publish-dialog]').waitFor({ state: 'visible', timeout: 5000 });
  await shot(guyPage, '11-publish-dialog');
  assert.match(await guyPage.locator('[data-publish-dialog]').innerText(), /發布 2026-W41 為 v1？發布後無法修改/);
  await guyPage.keyboard.press('Escape');
  await guyPage.locator('[data-publish-dialog]').waitFor({ state: 'hidden', timeout: 5000 });
  assert.equal(posts, 0);
  await guyPage.locator('[data-publish]').click();
  await guyPage.locator('[data-publish-confirm]').click();
  await guyPage.locator('[data-publish]', { hasText: '發布中…' }).waitFor({ timeout: 5000 });
  assert.equal(await guyPage.locator('[data-publish]').isDisabled(), true);
  await guyPage.waitForURL(/#\/publications\/2026-W41\/1$/, { timeout: 15000 });
  assert.equal(posts, 1);
  await guyPage.unroute('**/api/weeks/2026-W41/publications');
  // document: 管理摘要, then 三課; version in the title row; project header, deliveries, evidence, links, personnel line
  await guyPage.locator('[data-file="s1"] app-project-schedule .gantt-row').first().waitFor({ timeout: 15000 });
  assert.equal(await guyPage.locator('[data-doc-version]').innerText(), '2026-W41 · v1');
  assert.deepEqual(await guyPage.locator('.doc h2').allInnerTexts(), ['管理摘要', '第一課', '第二課', '第三課']);
  assert.equal(await guyPage.locator('.doc .summary').innerText(), '本週有一項風險。');
  assert.equal(await guyPage.locator('[data-file="s1"] input, [data-file="s1"] [data-evidence-toggle], [data-file="s1"] [data-add-dependency]').count(), 0);
  const pub = guyPage.locator('[data-file="s1"] app-project-schedule').last();
  assert.equal(await pub.locator('[data-project-title]').innerText(), '新平台');
  assert.match(await pub.locator('.pj-title').innerText(), /負責人 王小明/);
  assert.equal(await pub.locator('.gantt-row-phase .plan-bar').count(), 1);
  assert.equal(await pub.locator('.gantt-row-phase .actual-bar').count(), 1);
  assert.match(await pub.locator('[data-health]').innerText(), /逾期 1 項\s*完成 0\/2/);
  assert.match(await pub.locator('[data-overall-progress]').innerText(), /整體進度 0%/);
  assert.match(await pub.locator('[data-deliveries-table]').innerText(), /伺服器採購\s+資訊採購組\s+2026-10-15\s+已交付/);
  await pub.locator('.btn-phase-expand').click();
  assert.match(await pub.locator('.gantt-evidence-chip').innerText(), /2/);
  assert.match(await pub.locator('.gantt-evidence-chip').getAttribute('title'), /管線已上線/);
  assert.equal(await guyPage.locator('[data-file="s1"] [data-source-links] a').getAttribute('href'), 'https://example.com/notice');
  assert.equal(await guyPage.locator('[data-file="s2"] [data-impact-line]').innerText(), '交接：交接給同課同仁；影響：無；下一步：補人（2026-10-05 生效）');
  assert.equal(await guyPage.locator('[data-old-version]').count(), 0);
  await shot(guyPage, '12-publication');
  // printing hides the top bar and the document controls
  await guyPage.emulateMedia({ media: 'print' });
  assert.equal(await guyPage.locator('[data-shell]').isHidden(), true);
  assert.equal(await guyPage.locator('[data-print]').isHidden(), true);
  assert.equal(await guyPage.locator('.doc .summary').isVisible(), true);
  await guyPage.emulateMedia({ media: null });
  // a failed publish stays on the editor and reports in the save bar; retry then makes v2
  await guyPage.goto(url);
  await guyPage.locator('[data-save-state="clean"]').waitFor({ timeout: 15000 });
  await guyPage.route('**/api/weeks/2026-W41/publications', r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
  await guyPage.locator('[data-publish]').click();
  await guyPage.locator('[data-publish-confirm]').click();
  await guyPage.locator('[data-save-bar] [role="alert"]', { hasText: '發布失敗：boom' }).waitFor({ timeout: 5000 });
  assert.match(guyPage.url(), /#\/weeks\/2026-W41\/cross\/summary$/);
  assert.equal(await guyPage.locator('[data-publish]').isDisabled(), false);
  await guyPage.unroute('**/api/weeks/2026-W41/publications');
  await guyPage.locator('[data-publish]').click();
  await guyPage.locator('[data-publish-confirm]').click();
  await guyPage.waitForURL(/#\/publications\/2026-W41\/2$/, { timeout: 15000 });
  await guyPage.locator('[data-version-select]').selectOption('2026-W41/1');
  await guyPage.waitForURL(/#\/publications\/2026-W41\/1$/, { timeout: 15000 });
  await guyPage.locator('[data-doc-version]', { hasText: '2026-W41 · v1' }).waitFor({ timeout: 15000 });
  assert.equal(await guyPage.locator('[data-old-version]').innerText(), '舊版');
  assert.equal(await guyPage.locator('[data-shell]').count(), 1);
  // home: latest card, week status pills, and 正式版 nav now present
  await guyPage.locator('[data-nav="home"]').click();
  await guyPage.locator('[data-latest-publication]').waitFor({ timeout: 15000 });
  assert.match(await guyPage.locator('[data-latest-publication]').innerText(), /2026-W41 v2 · \d\d\/\d\d 發布/);
  assert.deepEqual(await guyPage.locator('[data-week-status]').allInnerTexts(), ['草稿', '已發布 v2']);
  await shot(guyPage, '13-home-published');
  await guyPage.locator('[data-nav="pub"]').click();
  await guyPage.waitForURL(/#\/publications\/2026-W41\/2$/, { timeout: 15000 });
  // a newer week publishes: dropdown groups weeks newest first with versions newest first; older versions get the pill
  await guyPage.goto(base + '/#/weeks/2026-W42');
  await guyPage.locator('[data-publish]', { hasText: '發布 2026-W42' }).waitFor({ timeout: 15000 });
  await guyPage.locator('[data-publish]').click();
  assert.match(await guyPage.locator('[data-publish-dialog]').innerText(), /發布 2026-W42 為 v1？/);
  await guyPage.locator('[data-publish-confirm]').click();
  await guyPage.waitForURL(/#\/publications\/2026-W42\/1$/, { timeout: 15000 });
  await guyPage.locator('[data-doc-version]', { hasText: '2026-W42 · v1' }).waitFor({ timeout: 15000 });
  assert.equal(await guyPage.locator('[data-old-version]').count(), 0);
  assert.deepEqual(await guyPage.locator('[data-version-select] optgroup').evaluateAll(g => g.map(x => x.label)), ['2026-W42', '2026-W41']);
  assert.deepEqual((await guyPage.locator('[data-version-select] option').allInnerTexts()).map(x => x.replace(/\d\d\/\d\d/, 'MM/DD')), ['v1 · MM/DD 發布', 'v2 · MM/DD 發布', 'v1 · MM/DD 發布']);
  assert.equal(await guyPage.locator('.doc h2').count(), 1, 'empty sections have no heading');
  await guyPage.locator('[data-version-select]').selectOption('2026-W41/2');
  await guyPage.waitForURL(/#\/publications\/2026-W41\/2$/, { timeout: 15000 });
  await guyPage.locator('[data-old-version]').waitFor({ timeout: 15000 });
  await shot(guyPage, '14-publication-old-version');
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
