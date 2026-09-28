import { ChangeDetectorRef, Component, HostListener, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterOutlet, Routes } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Auth, editorGuard, entryGuard, readerGuard } from './auth';

type User = { empNo: string; name: string; role: string; section: string | null };
type Lease = { holder: string; expiresAt: string } | null;
type Item = { id: string; continuityId: string; section: string; ownerSection: string; title: string; content: string; status: string; version: number; lease: Lease; schedule?: ScheduleEntry[] };
type ProjectWork = { section: string; work: string; scheduleProposal: string | null; version: number; updatedBy: string; updatedAt: string };
type ScheduleEntry = { id: string; kind: 'phase' | 'milestone'; name: string; baselineStart: string | null; baselineEnd: string | null; forecastStart: string | null; forecastEnd: string | null; actualStart: string | null; actualEnd: string | null; version: number };
type EcimMember = { userId: string; periodFrom: string | null; periodTo: string | null; status: string; error: string | null; lastSuccessAt: string | null };
type EcimCandidate = { id: string; status: string; workId: string; periodFrom: string; periodTo: string };
type Report = { id: string; meetingDate: string; sections: string[]; items: Item[] };
type Conflict = { latest: Item; draft: { title: string; content: string } | null; lease: Lease; error: string };
const labels: Record<string, string> = {
  summary: '本週管理摘要', projects: '進行中專案進度', operations: '系統維護與營運',
  personnel: '人力與組織異動', technology: '新技術評估', appendix: '工程師工作明細與來源連結'
};

@Component({ selector: 'app-root', standalone: true, imports: [RouterOutlet], template: '<router-outlet />' })
export class App {}

@Component({ standalone: true, imports: [CommonModule, FormsModule], template: `
<header><h1>處會週報</h1><span>{{me?.name}} · {{me?.role}}</span></header>
<main><section class="card"><h2>週報</h2>
  <p *ngIf="message" class="message">{{message}}</p>
  <form *ngIf="me?.role === 'Guy'" (ngSubmit)="create()">
    <label>處會日期 <input type="date" name="date" [(ngModel)]="meetingDate" required></label>
    <button>建立或開啟週報</button>
  </form>
  <ul><li *ngFor="let report of reports"><a href="#/reports/{{report.id}}">{{report.meetingDate}}</a></li></ul>
</section></main>` })
export class Home implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);
  private changes = inject(ChangeDetectorRef);
  me: User | null = null;
  reports: { id: string; meetingDate: string }[] = [];
  meetingDate = new Date().toISOString().slice(0, 10);
  message = '';
  async ngOnInit() {
    this.me = await firstValueFrom(this.http.get<User>('/api/me'));
    this.reports = await firstValueFrom(this.http.get<typeof this.reports>('/api/reports'));
    this.changes.detectChanges();
  }
  async create() {
    try {
      const report = await firstValueFrom(this.http.post<Report>('/api/reports', { meetingDate: this.meetingDate }));
      await this.router.navigate(['/reports', report.id]);
    } catch { this.message = '無法建立週報。'; this.changes.detectChanges(); }
  }
}

@Component({ standalone: true, imports: [CommonModule, FormsModule], template: `
<header><h1>處會週報 <small>{{report?.meetingDate}}</small></h1><span><button *ngIf="me?.role === 'Guy'" (click)="publish()">發布正式版</button><a href="#/">週報清單</a></span></header>
<main *ngIf="report" class="editor">
  <nav><h2>章節與項目</h2><p *ngIf="publicationUrl"><a [href]="publicationUrl">查看剛發布的固定版本</a></p>
  <section *ngIf="me?.role === 'Head'" class="source-sync"><h3>eCIM 來源同步</h3><button (click)="syncEcim()">同步本課工程師工作</button>
    <p *ngIf="ecimMessage">{{ecimMessage}}</p><ul><li *ngFor="let member of ecimMembers">{{member.userId}} · {{member.periodFrom || '未設定'}}–{{member.periodTo || '未設定'}} · {{member.status === 'succeeded' ? '成功' : member.status === 'failed' ? '失敗' : '尚未同步'}} · 上次成功：{{member.lastSuccessAt ? (member.lastSuccessAt | date:'short') : '尚未成功'}}<span *ngIf="member.error"> · {{member.error}}</span></li></ul>
    <p *ngIf="ecimCandidates.length">新來源候選</p><ul><li *ngFor="let candidate of ecimCandidates">{{candidate.workId}} · {{candidate.periodFrom}}–{{candidate.periodTo}}</li></ul>
  </section><section *ngFor="let section of report.sections">
    <h3>{{label(section)}}</h3><button *ngIf="canAdd(section)" (click)="add(section)">新增項目</button>
    <button class="item" *ngFor="let item of inSection(section)" (click)="select(item)">{{item.title}} <span *ngIf="item.lease">🔒</span></button>
  </section></nav>
  <article><p *ngIf="message" class="message">{{message}}</p>
    <ng-container *ngIf="selected as item"><h2>{{label(item.section)}}</h2>
      <p>共用版本 {{item.version}} <span *ngIf="item.lease">· {{item.lease.holder}} 編輯至 {{item.lease.expiresAt | date:'short'}}</span></p>
      <div *ngIf="!token"><h3>{{item.title}}</h3><p>{{item.content}}</p><button (click)="acquire()">開始編輯</button></div>
      <div *ngIf="token"><label>標題 <input [(ngModel)]="draftTitle" (ngModelChange)="scheduleSave()"></label>
        <label>內容 <textarea rows="12" [(ngModel)]="draftContent" (ngModelChange)="scheduleSave()"></textarea></label>
        <label><input type="checkbox" [checked]="draftStatus === 'closed'" (change)="draftStatus = $any($event.target).checked ? 'closed' : 'open'"> 本週結案（下週不再延續）</label>
        <p>{{saveState}}</p><button (click)="commit()">儲存完成</button><button (click)="release()">取消編輯</button></div>
      <div *ngIf="conflict" class="conflict"><h3>編輯衝突</h3><p>{{conflict.error}}</p>
        <div class="compare"><div><strong>最新共用版本 {{conflict.latest.version}}</strong><p>{{conflict.latest.title}}</p><p>{{conflict.latest.content}}</p></div>
        <div><strong>我的私有草稿</strong><p>{{conflict.draft?.title || draftTitle}}</p><p>{{conflict.draft?.content || draftContent}}</p></div></div>
        <button (click)="reloadAndAcquire()">重新取得租約並套用我的草稿</button></div>
      <div *ngIf="me?.role === 'Guy' && item.lease && item.lease.holder !== me?.empNo">
        <label>接管理由 <input [(ngModel)]="takeoverReason"></label><button (click)="takeover()">接管租約</button></div>
      <section *ngIf="item.section === 'projects'" class="project-work"><h3>參與課別工作與時程建議</h3>
        <button *ngIf="canMaintain(item)" (click)="assignParticipant()">指定參與課別</button>
        <ul *ngIf="projectWork.length"><li *ngFor="let entry of projectWork"><strong>{{entry.section}}</strong> · {{entry.work}}<span *ngIf="entry.scheduleProposal"> · 時程建議：{{entry.scheduleProposal}}</span></li></ul>
        <div *ngIf="isParticipant"><label>我承擔的工作 <textarea rows="4" [(ngModel)]="myProjectWork"></textarea></label>
          <label>時程變更建議（選填） <input [(ngModel)]="myScheduleProposal"></label><button (click)="saveProjectWork()">送出給週報維護人</button></div>
      </section>
      <section *ngIf="item.section === 'projects'" class="project-schedule"><h3>專案階段與重要里程碑</h3>
        <ul><li *ngFor="let entry of scheduleEntries"><strong>{{entry.kind === 'phase' ? '階段' : '里程碑'}}：{{entry.name}}</strong>
          · 基準 {{entry.baselineStart || '—'}}–{{entry.baselineEnd || '—'}} · 預估 {{entry.forecastStart || '—'}}–{{entry.forecastEnd || '—'}} · 實際 {{entry.actualStart || '—'}}–{{entry.actualEnd || '—'}}
          <button *ngIf="canMaintain(item)" (click)="editSchedule(entry)">編輯</button></li></ul>
        <div *ngIf="canMaintain(item)"><h4>{{editingSchedule ? '編輯時程' : '新增時程'}}</h4>
          <label>類型 <select [(ngModel)]="scheduleDraft.kind"><option value="phase">階段</option><option value="milestone">重要里程碑</option></select></label>
          <label>名稱 <input [(ngModel)]="scheduleDraft.name"></label>
          <label>計畫基準開始 <input type="date" [(ngModel)]="scheduleDraft.baselineStart"></label><label>計畫基準結束 <input type="date" [(ngModel)]="scheduleDraft.baselineEnd"></label>
          <label>目前預估開始 <input type="date" [(ngModel)]="scheduleDraft.forecastStart"></label><label>目前預估結束 <input type="date" [(ngModel)]="scheduleDraft.forecastEnd"></label>
          <label>實際開始 <input type="date" [(ngModel)]="scheduleDraft.actualStart"></label><label>實際結束 <input type="date" [(ngModel)]="scheduleDraft.actualEnd"></label>
          <label *ngIf="editingSchedule">基準異動原因 <input [(ngModel)]="scheduleDraft.baselineChangeReason"></label>
          <button (click)="saveSchedule()">{{editingSchedule ? '儲存時程' : '新增時程'}}</button><button *ngIf="editingSchedule" (click)="resetScheduleDraft()">取消</button></div>
      </section>
      <details><summary>修訂紀錄</summary><button (click)="loadHistory()">重新整理</button>
        <ul><li *ngFor="let entry of history">{{entry.at | date:'short'}} · {{entry.actor}} · {{entry.action}}
          <span *ngIf="entry.action === 'commit'"> {{entry.beforeVersion}} → {{entry.afterVersion}}</span>
          <span *ngIf="entry.reason"> · {{entry.reason}}</span></li></ul></details>
    </ng-container><p *ngIf="!selected">請選擇項目。</p>
  </article>
</main>` })
export class ReportEditor implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private changes = inject(ChangeDetectorRef);
  private auth = inject(Auth);
  private route = inject(ActivatedRoute);
  report: Report | null = null;
  me: User | null = null;
  selected: Item | null = null;
  token = '';
  baseVersion = 0;
  draftTitle = '';
  draftContent = '';
  draftStatus = 'open';
  saveState = '';
  message = '';
  conflict: Conflict | null = null;
  history: any[] = [];
  projectWork: ProjectWork[] = [];
  myProjectWork = '';
  myScheduleProposal = '';
  myProjectWorkVersion = 0;
  isParticipant = false;
  scheduleEntries: ScheduleEntry[] = [];
  editingSchedule: ScheduleEntry | null = null;
  scheduleDraft = this.emptyScheduleDraft();
  ecimMembers: EcimMember[] = [];
  ecimCandidates: EcimCandidate[] = [];
  ecimMessage = '';
  takeoverReason = '';
  publicationUrl = '';
  private pendingPublicationRequestId = '';
  private saveTimer?: ReturnType<typeof setTimeout>;
  private renewTimer?: ReturnType<typeof setInterval>;
  private reportId = this.route.snapshot.paramMap.get('id')!;
  label(section: string) { return labels[section] ?? section; }
  inSection(section: string) { return this.report?.items.filter(item => item.section === section) ?? []; }
  canAdd(_section: string) { return this.me?.role === 'Guy' || this.me?.role === 'Head'; }
  async ngOnInit() { this.me = await firstValueFrom(this.http.get<User>('/api/me')); await this.refresh(); await this.loadEcimStatus(); }
  ngOnDestroy() { clearTimeout(this.saveTimer); clearInterval(this.renewTimer); this.releaseOnExit(); }
  @HostListener('window:pagehide') onPageHide() { this.releaseOnExit(); }
  private releaseOnExit() {
    if (!this.selected || !this.token) return;
    const itemId = this.selected.id;
    const leaseToken = this.token;
    this.token = '';
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.auth.token()}` };
    fetch(`/api/items/${itemId}/private-draft`, {
      method: 'PUT', keepalive: true, headers,
      body: JSON.stringify({ title: this.draftTitle, content: this.draftContent, status: this.draftStatus })
    }).catch(() => {});
    fetch(`/api/items/${itemId}/lease`, {
      method: 'DELETE', keepalive: true,
      headers,
      body: JSON.stringify({ token: leaseToken })
    }).catch(() => {});
  }
  async refresh() {
    this.report = await firstValueFrom(this.http.get<Report>(`/api/reports/${this.reportId}`));
    if (this.selected) this.selected = this.report.items.find(item => item.id === this.selected?.id) ?? null;
    this.changes.detectChanges();
  }
  async loadEcimStatus() {
    if (this.me?.role !== 'Head') return;
    try {
      const status = await firstValueFrom(this.http.get<{ members: EcimMember[] }>(`/api/reports/${this.reportId}/ecim-sync`));
      this.ecimMembers = status.members;
      this.ecimCandidates = await firstValueFrom(this.http.get<EcimCandidate[]>(`/api/reports/${this.reportId}/ecim-candidates`));
    } catch { this.ecimMessage = '尚未設定或無法載入 eCIM 來源狀態。'; }
    this.changes.detectChanges();
  }
  async syncEcim() {
    try {
      const run = await firstValueFrom(this.http.post<{ status: string }>(`/api/reports/${this.reportId}/ecim-sync`, {}));
      this.ecimMessage = run.status === 'succeeded' ? '本課來源同步完成。' : '同步完成，但部分成員失敗。';
      await this.loadEcimStatus();
    } catch { this.ecimMessage = '來源同步失敗。'; this.changes.detectChanges(); }
  }
  async add(section: string) {
    const title = prompt('項目標題');
    if (!title?.trim()) return;
    const ownerSection = section === 'personnel' && this.me?.role === 'Guy' ? prompt('相關課別（例如 s1）')?.trim() : undefined;
    if (section === 'personnel' && this.me?.role === 'Guy' && !ownerSection) return;
    try {
      const item = await firstValueFrom(this.http.post<{ id: string }>(`/api/reports/${this.reportId}/items`, { section, title, ownerSection }));
      await this.refresh();
      this.select(this.report!.items.find(i => i.id === item.id)!);
    } catch { this.message = '無法新增項目。'; this.changes.detectChanges(); }
  }
  async select(item: Item) {
    if (this.token) {
      clearTimeout(this.saveTimer);
      await this.save();
      if (this.saveState !== '私人草稿已儲存') { this.message = '請先確認草稿儲存成功。'; return; }
      await this.release();
    }
    clearInterval(this.renewTimer); clearTimeout(this.saveTimer);
    this.selected = item; this.token = ''; this.conflict = null; this.history = []; this.message = '';
    this.draftTitle = item.title; this.draftContent = item.content; this.draftStatus = item.status;
    this.projectWork = []; this.myProjectWork = ''; this.myScheduleProposal = ''; this.myProjectWorkVersion = 0; this.isParticipant = false;
    this.scheduleEntries = []; this.resetScheduleDraft();
    if (item.section === 'projects') { await this.loadProjectWork(); await this.loadSchedule(); }
    this.changes.detectChanges();
  }
  canMaintain(item: Item) { return item.section === 'projects' && (this.me?.role === 'Guy' || this.me?.role === 'Head' && this.me.section === item.ownerSection); }
  async assignParticipant() {
    if (!this.selected) return;
    const section = prompt('參與課別（例如 s2）');
    if (!section?.trim()) return;
    try { await firstValueFrom(this.http.post(`/api/items/${this.selected.id}/project-participants`, { section: section.trim() })); this.message = '已指定參與課別。'; }
    catch { this.message = '無法指定參與課別。'; }
    this.changes.detectChanges();
  }
  async loadProjectWork() {
    if (!this.selected) return;
    try {
      this.projectWork = await firstValueFrom(this.http.get<ProjectWork[]>(`/api/items/${this.selected.id}/project-work`));
      const mine = this.projectWork.find(entry => entry.section === this.me?.section);
      this.isParticipant = !!mine || !this.canMaintain(this.selected);
      this.myProjectWork = mine?.work ?? '';
      this.myScheduleProposal = mine?.scheduleProposal ?? '';
      this.myProjectWorkVersion = mine?.version ?? 0;
    } catch { this.isParticipant = false; }
  }
  async saveProjectWork() {
    if (!this.selected) return;
    try {
      await firstValueFrom(this.http.put(`/api/items/${this.selected.id}/project-work`, { work: this.myProjectWork, scheduleProposal: this.myScheduleProposal, baseVersion: this.myProjectWorkVersion }));
      await this.loadProjectWork(); this.message = '已送出給週報維護人。';
    } catch { this.message = '送出參與工作失敗。'; }
    this.changes.detectChanges();
  }
  emptyScheduleDraft() { return { kind: 'phase' as 'phase' | 'milestone', name: '', baselineStart: '', baselineEnd: '', forecastStart: '', forecastEnd: '', actualStart: '', actualEnd: '', baselineChangeReason: '' }; }
  async loadSchedule() {
    if (!this.selected) return;
    try { this.scheduleEntries = await firstValueFrom(this.http.get<ScheduleEntry[]>(`/api/items/${this.selected.id}/schedule`)); } catch { this.scheduleEntries = []; }
  }
  editSchedule(entry: ScheduleEntry) {
    this.editingSchedule = entry;
    this.scheduleDraft = { kind: entry.kind, name: entry.name, baselineStart: entry.baselineStart ?? '', baselineEnd: entry.baselineEnd ?? '', forecastStart: entry.forecastStart ?? '', forecastEnd: entry.forecastEnd ?? '', actualStart: entry.actualStart ?? '', actualEnd: entry.actualEnd ?? '', baselineChangeReason: '' };
  }
  resetScheduleDraft() { this.editingSchedule = null; this.scheduleDraft = this.emptyScheduleDraft(); }
  async saveSchedule() {
    if (!this.selected) return;
    const value = (date: string) => date || null;
    const body = { ...this.scheduleDraft, baselineStart: value(this.scheduleDraft.baselineStart), baselineEnd: value(this.scheduleDraft.baselineEnd), forecastStart: value(this.scheduleDraft.forecastStart), forecastEnd: value(this.scheduleDraft.forecastEnd), actualStart: value(this.scheduleDraft.actualStart), actualEnd: value(this.scheduleDraft.actualEnd) };
    try {
      if (this.editingSchedule) await firstValueFrom(this.http.put(`/api/items/${this.selected.id}/schedule/${this.editingSchedule.id}`, { ...body, baseVersion: this.editingSchedule.version }));
      else await firstValueFrom(this.http.post(`/api/items/${this.selected.id}/schedule`, body));
      await this.loadSchedule(); this.resetScheduleDraft(); this.message = '已儲存結構化時程。';
    } catch { this.message = '無法儲存時程；基準異動須填寫原因。'; }
    this.changes.detectChanges();
  }
  async acquire() {
    if (!this.selected) return;
    try {
      const lease = await firstValueFrom(this.http.post<{ token: string; baseVersion: number }>(`/api/items/${this.selected.id}/lease`, {}));
      this.token = lease.token; this.baseVersion = lease.baseVersion;
      this.renewTimer = setInterval(() => this.renew(), 5 * 60 * 1000);
      try {
        const draft = await firstValueFrom(this.http.get<{ title: string; content: string; status: string }>(`/api/items/${this.selected.id}/private-draft`));
        this.draftTitle = draft.title; this.draftContent = draft.content; this.draftStatus = draft.status;
      } catch { /* no existing draft */ }
    } catch (error: any) { this.conflict = error.error; await this.refresh(); }
    this.changes.detectChanges();
  }
  async renew() {
    if (!this.selected || !this.token) return;
    try { await firstValueFrom(this.http.post(`/api/items/${this.selected.id}/lease/renew`, { token: this.token })); }
    catch (error: any) { this.conflict = error.error; clearInterval(this.renewTimer); this.changes.detectChanges(); }
  }
  scheduleSave() {
    this.saveState = '儲存中'; clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 700);
  }
  async save() {
    if (!this.selected) return;
    try {
      await firstValueFrom(this.http.put(`/api/items/${this.selected.id}/private-draft`, { title: this.draftTitle, content: this.draftContent, status: this.draftStatus }));
      this.saveState = '私人草稿已儲存';
    } catch { this.saveState = '草稿儲存失敗'; }
    this.changes.detectChanges();
  }
  async commit() {
    if (!this.selected) return;
    clearTimeout(this.saveTimer); await this.save();
    if (this.saveState !== '私人草稿已儲存') return;
    try {
      await firstValueFrom(this.http.post(`/api/items/${this.selected.id}/commit`, { token: this.token, baseVersion: this.baseVersion, status: this.draftStatus }));
      this.token = ''; clearInterval(this.renewTimer); this.conflict = null;
      await this.refresh(); this.message = '已儲存完成。';
    } catch (error: any) { this.conflict = error.error; this.message = '提交遇到衝突，私有草稿已保留。'; this.changes.detectChanges(); }
  }
  async release() {
    if (!this.selected) return;
    clearTimeout(this.saveTimer);
    await this.save();
    if (this.saveState !== '私人草稿已儲存') { this.message = '請先確認草稿儲存成功。'; return; }
    try { await firstValueFrom(this.http.request('DELETE', `/api/items/${this.selected.id}/lease`, { body: { token: this.token } })); } catch {}
    this.token = ''; clearInterval(this.renewTimer); await this.refresh();
  }
  async takeover() {
    if (!this.selected || !this.takeoverReason.trim()) return;
    try {
      const lease = await firstValueFrom(this.http.post<{ token: string; baseVersion: number }>(`/api/items/${this.selected.id}/lease/takeover`, { reason: this.takeoverReason }));
      this.token = lease.token; this.baseVersion = lease.baseVersion; this.conflict = null;
      this.renewTimer = setInterval(() => this.renew(), 5 * 60 * 1000);
      await this.refresh(); await this.loadHistory();
    } catch { this.message = '接管失敗。'; this.changes.detectChanges(); }
  }
  async reloadAndAcquire() { await this.refresh(); this.token = ''; this.conflict = null; await this.acquire(); }
  async publish() {
    try {
      this.pendingPublicationRequestId ||= sessionStorage.getItem(`publication-request:${this.reportId}`) ?? crypto.randomUUID();
      sessionStorage.setItem(`publication-request:${this.reportId}`, this.pendingPublicationRequestId);
      const publication = await firstValueFrom(this.http.post<{ id: string; version: number }>(`/api/reports/${this.reportId}/publications`, { requestId: this.pendingPublicationRequestId }));
      this.pendingPublicationRequestId = '';
      sessionStorage.removeItem(`publication-request:${this.reportId}`);
      this.publicationUrl = `#/publications/${publication.id}`;
      this.message = `已發布正式版 ${publication.version}。`;
      this.changes.detectChanges();
    } catch { this.message = '發布失敗。'; this.changes.detectChanges(); }
  }
  async loadHistory() {
    if (this.selected) this.history = await firstValueFrom(this.http.get<any[]>(`/api/items/${this.selected.id}/history`));
    this.changes.detectChanges();
  }
}

@Component({ standalone: true, imports: [CommonModule], template: `
<header><h1>正式處會週報 <small>{{publication?.meetingDate}}</small></h1><a href="#/">週報清單</a></header>
<main *ngIf="publication" class="publication"><p>版本 {{publication.version}} · 發布於 {{publication.publishedAt | date:'short'}}</p>
  <section *ngFor="let section of publication.sections"><h2>{{label(section)}}</h2>
    <article *ngFor="let item of inSection(section)"><h3>{{item.title}}</h3><p>{{item.content}}</p>
      <ul *ngIf="item.schedule?.length"><li *ngFor="let entry of item.schedule"><strong>{{entry.kind === 'phase' ? '階段' : '重要里程碑'}}：{{entry.name}}</strong>
        · 基準 {{entry.baselineStart || '—'}}–{{entry.baselineEnd || '—'}} · 預估 {{entry.forecastStart || '—'}}–{{entry.forecastEnd || '—'}} · 實際 {{entry.actualStart || '—'}}–{{entry.actualEnd || '—'}}</li></ul>
    </article>
  </section>
</main>` })
export class PublicationPage implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private changes = inject(ChangeDetectorRef);
  publication: (Report & { version: number; publishedAt: string }) | null = null;
  private publicationId = this.route.snapshot.paramMap.get('id')!;
  label(section: string) { return labels[section] ?? section; }
  inSection(section: string) { return this.publication?.items.filter(item => item.section === section) ?? []; }
  async ngOnInit() { this.publication = await firstValueFrom(this.http.get<typeof this.publication>(`/api/publications/${this.publicationId}`)); this.changes.detectChanges(); }
}

@Component({ standalone: true, imports: [CommonModule], template: `
<header><h1>正式處會週報</h1></header>
<main><p *ngIf="message">{{message}}</p><a *ngIf="publicationUrl" [href]="publicationUrl">開啟最新正式發布版</a></main>` })
export class ReaderEntrance implements OnInit {
  private http = inject(HttpClient);
  private changes = inject(ChangeDetectorRef);
  publicationUrl = '';
  message = '';
  async ngOnInit() {
    try {
      const latest = await firstValueFrom(this.http.get<{ id: string }>('/api/publications/latest'));
      this.publicationUrl = `#/publications/${latest.id}`;
    } catch (error: any) {
      this.message = error.status === 404 ? '尚無正式發布版' : '無法載入正式發布版。';
    }
    this.changes.detectChanges();
  }
}

@Component({ standalone: true, template: '<main><h1>無權限</h1><p>此帳號無法編輯處會週報。</p></main>' })
export class Forbidden {}

export const routes: Routes = [
  { path: '', component: Home, canActivate: [entryGuard] },
  { path: 'reports/:id', component: ReportEditor, canActivate: [editorGuard] },
  { path: 'publications/:id', component: PublicationPage, canActivate: [readerGuard] },
  { path: 'reader', component: ReaderEntrance, canActivate: [readerGuard] },
  { path: 'forbidden', component: Forbidden },
  { path: '**', redirectTo: '' }
];
