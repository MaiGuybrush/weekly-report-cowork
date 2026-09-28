import { ChangeDetectorRef, Component, HostListener, inject, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router, RouterOutlet, Routes } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Auth, editorGuard } from './auth';

type User = { empNo: string; name: string; role: string; section: string | null };
type Lease = { holder: string; expiresAt: string } | null;
type Item = { id: string; section: string; ownerSection: string; title: string; content: string; version: number; lease: Lease };
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
<header><h1>處會週報 <small>{{report?.meetingDate}}</small></h1><a href="#/">週報清單</a></header>
<main *ngIf="report" class="editor">
  <nav><h2>章節與項目</h2><section *ngFor="let section of report.sections">
    <h3>{{label(section)}}</h3><button *ngIf="canAdd(section)" (click)="add(section)">新增項目</button>
    <button class="item" *ngFor="let item of inSection(section)" (click)="select(item)">{{item.title}} <span *ngIf="item.lease">🔒</span></button>
  </section></nav>
  <article><p *ngIf="message" class="message">{{message}}</p>
    <ng-container *ngIf="selected as item"><h2>{{label(item.section)}}</h2>
      <p>共用版本 {{item.version}} <span *ngIf="item.lease">· {{item.lease.holder}} 編輯至 {{item.lease.expiresAt | date:'short'}}</span></p>
      <div *ngIf="!token"><h3>{{item.title}}</h3><p>{{item.content}}</p><button (click)="acquire()">開始編輯</button></div>
      <div *ngIf="token"><label>標題 <input [(ngModel)]="draftTitle" (ngModelChange)="scheduleSave()"></label>
        <label>內容 <textarea rows="12" [(ngModel)]="draftContent" (ngModelChange)="scheduleSave()"></textarea></label>
        <p>{{saveState}}</p><button (click)="commit()">儲存完成</button><button (click)="release()">取消編輯</button></div>
      <div *ngIf="conflict" class="conflict"><h3>編輯衝突</h3><p>{{conflict.error}}</p>
        <div class="compare"><div><strong>最新共用版本 {{conflict.latest.version}}</strong><p>{{conflict.latest.title}}</p><p>{{conflict.latest.content}}</p></div>
        <div><strong>我的私有草稿</strong><p>{{conflict.draft?.title || draftTitle}}</p><p>{{conflict.draft?.content || draftContent}}</p></div></div>
        <button (click)="reloadAndAcquire()">重新取得租約並套用我的草稿</button></div>
      <div *ngIf="me?.role === 'Guy' && item.lease && item.lease.holder !== me?.empNo">
        <label>接管理由 <input [(ngModel)]="takeoverReason"></label><button (click)="takeover()">接管租約</button></div>
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
  saveState = '';
  message = '';
  conflict: Conflict | null = null;
  history: any[] = [];
  takeoverReason = '';
  private saveTimer?: ReturnType<typeof setTimeout>;
  private renewTimer?: ReturnType<typeof setInterval>;
  private reportId = this.route.snapshot.paramMap.get('id')!;
  label(section: string) { return labels[section] ?? section; }
  inSection(section: string) { return this.report?.items.filter(item => item.section === section) ?? []; }
  canAdd(_section: string) { return this.me?.role === 'Guy' || this.me?.role === 'Head'; }
  async ngOnInit() { this.me = await firstValueFrom(this.http.get<User>('/api/me')); await this.refresh(); }
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
      body: JSON.stringify({ title: this.draftTitle, content: this.draftContent })
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
  async add(section: string) {
    const title = prompt('項目標題');
    if (!title?.trim()) return;
    try {
      const item = await firstValueFrom(this.http.post<{ id: string }>(`/api/reports/${this.reportId}/items`, { section, title }));
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
    this.draftTitle = item.title; this.draftContent = item.content;
    this.changes.detectChanges();
  }
  async acquire() {
    if (!this.selected) return;
    try {
      const lease = await firstValueFrom(this.http.post<{ token: string; baseVersion: number }>(`/api/items/${this.selected.id}/lease`, {}));
      this.token = lease.token; this.baseVersion = lease.baseVersion;
      this.renewTimer = setInterval(() => this.renew(), 5 * 60 * 1000);
      try {
        const draft = await firstValueFrom(this.http.get<{ title: string; content: string }>(`/api/items/${this.selected.id}/private-draft`));
        this.draftTitle = draft.title; this.draftContent = draft.content;
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
      await firstValueFrom(this.http.put(`/api/items/${this.selected.id}/private-draft`, { title: this.draftTitle, content: this.draftContent }));
      this.saveState = '私人草稿已儲存';
    } catch { this.saveState = '草稿儲存失敗'; }
    this.changes.detectChanges();
  }
  async commit() {
    if (!this.selected) return;
    clearTimeout(this.saveTimer); await this.save();
    if (this.saveState !== '私人草稿已儲存') return;
    try {
      await firstValueFrom(this.http.post(`/api/items/${this.selected.id}/commit`, { token: this.token, baseVersion: this.baseVersion }));
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
  async loadHistory() {
    if (this.selected) this.history = await firstValueFrom(this.http.get<any[]>(`/api/items/${this.selected.id}/history`));
    this.changes.detectChanges();
  }
}

@Component({ standalone: true, template: '<main><h1>無權限</h1><p>此帳號無法編輯處會週報。</p></main>' })
export class Forbidden {}

export const routes: Routes = [
  { path: '', component: Home, canActivate: [editorGuard] },
  { path: 'reports/:id', component: ReportEditor, canActivate: [editorGuard] },
  { path: 'forbidden', component: Forbidden },
  { path: '**', redirectTo: '' }
];
