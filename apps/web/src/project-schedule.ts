import { ChangeDetectorRef, Component, inject, input } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { FormsModule } from "@angular/forms";
import { firstValueFrom } from "rxjs";
import { Gantt } from "./gantt";
import { cancelEntry, evaluateSchedule, reactivateEntry, type ScheduleInput } from "./schedule-rules";
import type { ExternalDependency, ScheduleEntry, SectionItem } from "./report-types";

const KEYS: (keyof ScheduleEntry)[] = [
  "id", "kind", "name", "owner", "phaseId", "state", "baselineStart", "baselineEnd", "forecastStart", "forecastEnd",
  "actualStart", "actualEnd", "baselineDate", "forecastDate", "actualDate", "predecessors", "evidenceLinks",
];
const RANGE_FIELDS = [["baselineStart", "原始開始"], ["baselineEnd", "原始結束"], ["forecastStart", "目前開始"], ["forecastEnd", "目前結束"], ["actualStart", "實際開始"], ["actualEnd", "實際結束"]];
const DATE_FIELDS = [["baselineDate", "原始日期"], ["forecastDate", "目前日期"], ["actualDate", "實際日期"]];
const SECTIONS = [["s1", "第一課"], ["s2", "第二課"], ["s3", "第三課"]];
const KIND_LABELS = { phase: "階段", task: "關鍵任務", milestone: "里程碑" };

/** Only contract fields reach the JSON: derived successors / warnings / externalNotices never do. */
export function cleanSchedule(entries: ScheduleEntry[]): ScheduleEntry[] {
  return entries.map((e) => Object.fromEntries(KEYS.filter((k) => e[k] !== undefined).map((k) => [k, e[k]])) as ScheduleEntry);
}

type WorkItem = { workId: number; workContent: string; ownerName: string; status: string; subItems?: WorkItem[] };

const toInput = (e: ScheduleEntry) => e as ScheduleInput;
const toDeliveries = (project: SectionItem) =>
  (project.externalDependencies ?? []).map((d) => ({ id: d.id, description: d.description, supplier: d.supplier, dueDate: d.dueDate, status: d.status, entryIds: d.linkedEntryIds }));

export function scheduleErrors(project: SectionItem) {
  const entries = project.schedule ?? [];
  const name = (id: string) => entries.find((e) => e.id === id)?.name || id;
  return evaluateSchedule(entries.map(toInput)).errors.map((x) => `「${project.title || "未命名專案"}」${name(x.entryId)} ← ${name(x.predecessorId)}：${x.message}`);
}

@Component({
  selector: "app-project-schedule",
  standalone: true,
  imports: [FormsModule, Gantt],
  template: `
    <!-- the app refreshes views manually (no zone events), so re-render after any edit bubbling up -->
    <div class="project" [attr.data-project]="project().id" (input)="changes.detectChanges()" (change)="changes.detectChanges()" (click)="changes.detectChanges()">
      <label>專案名稱
        <input data-field="project-title" [(ngModel)]="project().title" [disabled]="!editable()" /></label>
      <label>實際專案負責人
        <input data-field="project-owner" [(ngModel)]="project().owner" [disabled]="!editable()" /></label>
      <p>參與課別：
        @for (s of SECTIONS; track s[0]) {
          <label><input type="checkbox" [disabled]="!editable()" [checked]="has(s[0])" (change)="toggle(s[0])" /> {{ s[1] }}</label>
        }
        @if (!editable() && !project().participants?.length) { 無 }
      </p>

      @for (e of project().schedule; track e.id) {
        <div class="entry" [attr.data-entry]="e.name" [class.cancelled]="e.state === 'cancelled'">
          <strong>{{ KIND_LABELS[e.kind] }}</strong>
          <label>名稱 <input data-field="entry-name" [(ngModel)]="e.name" [disabled]="!editable() || e.state === 'cancelled'" /></label>
          @if (e.kind === 'task') {
            <label>負責人/單位 <input [(ngModel)]="e.owner" [disabled]="!editable()" /></label>
            <label>所屬階段
              <select [(ngModel)]="e.phaseId" [disabled]="!editable() || e.state === 'cancelled'">
                <option [ngValue]="null">（無）</option>
                @for (p of phases(); track p.id) { <option [ngValue]="p.id">{{ p.name }}</option> }
              </select></label>
          }
          @if (e.state !== 'cancelled') {
            <label>狀態
              <select [(ngModel)]="e.state" [disabled]="!editable()">
                @for (s of statesOf(e.kind); track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
              </select></label>
          }
          @for (f of e.kind === 'milestone' ? DATE_FIELDS : RANGE_FIELDS; track f[0]) {
            <label>{{ f[1] }}
              <input type="date" [attr.data-field]="f[0]" [ngModel]="$any(e)[f[0]]" (ngModelChange)="$any(e)[f[0]] = $event || null" [disabled]="!editable() || e.state === 'cancelled'" /></label>
          }
          @if (e.state !== 'cancelled') {
            <label>前置項目
              <select multiple data-field="predecessors" [(ngModel)]="e.predecessors" [disabled]="!editable()">
                @for (o of others(e); track o.id) { <option [value]="o.id">{{ o.name }}</option> }
              </select></label>
          }
          @for (msg of entryErrors(e.id); track msg) { <p class="error" role="alert">{{ msg }}</p> }
          @if (editable() && e.kind === 'task' && e.state !== 'cancelled') {
            <button type="button" data-evidence-toggle (click)="toggleEvidence(e.id)">📎 {{ e.evidenceLinks?.length || 0 }}</button>
            @if (evidenceOpen === e.id) {
              <div class="evidence-panel" data-evidence-panel>
                @for (l of e.evidenceLinks; track l.workId) {
                  <div class="evidence-link">
                    <span>#{{ l.workId }}</span>
                    <input data-field="evidence-summary" placeholder="摘要" [(ngModel)]="l.summary" />
                    <button type="button" (click)="unlink(e, l.workId)">移除</button>
                  </div>
                }
                @for (w of unlinked(e); track w.workId) {
                  <div class="evidence-candidate" [attr.data-work]="w.workId">
                    <button type="button" data-pick (click)="link(e, w.workId)">挑選</button>
                    #{{ w.workId }} {{ w.workContent }}（{{ w.ownerName }}・{{ w.status }}）
                    @for (c of w.subItems; track c.workId) { <small>　└ #{{ c.workId }} {{ c.workContent }}</small> }
                  </div>
                }
                <label>手動輸入 workId <input type="number" data-field="manual-work-id" [(ngModel)]="manualId" /></label>
                <button type="button" data-manual-add [disabled]="!manualId" (click)="link(e, manualId!); manualId = null">加入</button>
              </div>
            }
          }
          @if (editable()) {
            @if (e.state === 'cancelled') { <button type="button" (click)="reactivate(e.id)">重新啟用</button> }
            @else { <button type="button" (click)="cancel(e.id)">取消項目</button> }
            <button type="button" (click)="remove(e.id)">刪除</button>
          }
        </div>
      }
      @if (editable()) {
        <p>
          @for (k of KINDS; track k) { <button type="button" [attr.data-add-entry]="k" (click)="add(k)">新增{{ KIND_LABELS[k] }}</button> }
        </p>
      }

      <h4>外部交付</h4>
      @for (d of project().externalDependencies; track d.id) {
        <div class="entry">
          <label>內容 <input [(ngModel)]="d.description" [disabled]="!editable()" /></label>
          <label>供應者 <input [(ngModel)]="d.supplier" [disabled]="!editable()" /></label>
          <label>到期日 <input type="date" [(ngModel)]="d.dueDate" [disabled]="!editable()" /></label>
          <label>狀態
            <select [(ngModel)]="d.status" [disabled]="!editable()">
              <option value="pending">未交付</option><option value="delivered">已交付</option>
            </select></label>
          <label>關聯時程項目
            <select multiple [(ngModel)]="d.linkedEntryIds" [disabled]="!editable()">
              @for (o of project().schedule; track o.id) { <option [value]="o.id">{{ o.name }}</option> }
            </select></label>
          @if (editable()) { <button type="button" (click)="removeDependency(d)">刪除</button> }
        </div>
      }
      @if (editable()) { <button type="button" data-add-dependency (click)="addDependency()">新增外部交付</button> }

      <app-gantt [entries]="evaluated().entries" />
    </div>`,
})
export class ProjectSchedule {
  protected changes = inject(ChangeDetectorRef);
  private http = inject(HttpClient);
  project = input.required<SectionItem>();
  week = input("");
  evidenceOpen: string | null = null;
  manualId: number | null = null;
  work: WorkItem[] = [];
  private workLoaded = false;
  editable = input(false);
  readonly SECTIONS = SECTIONS;
  readonly KIND_LABELS = KIND_LABELS;
  readonly KINDS = ["phase", "task", "milestone"] as const;
  readonly RANGE_FIELDS = RANGE_FIELDS;
  readonly DATE_FIELDS = DATE_FIELDS;

  // ngModel mutates entries in place, so memoize on content: a fresh array per check would trip NG0100.
  private memo?: { key: string; value: ReturnType<typeof evaluateSchedule> };
  evaluated = () => {
    const p = this.project();
    const key = JSON.stringify([p.schedule, p.externalDependencies]);
    if (this.memo?.key !== key) this.memo = { key, value: evaluateSchedule((p.schedule ?? []).map(toInput), toDeliveries(p)) };
    return this.memo.value;
  };
  phases = () => (this.project().schedule ?? []).filter((e) => e.kind === "phase" && e.state !== "cancelled");
  others = (e: ScheduleEntry) => (this.project().schedule ?? []).filter((o) => o.id !== e.id && o.state !== "cancelled");
  entryErrors = (id: string) => {
    const entries = this.project().schedule ?? [];
    const name = (x: string) => entries.find((e) => e.id === x)?.name || x;
    return this.evaluated().errors.filter((x) => x.entryId === id).map((x) => `前置項目「${name(x.predecessorId)}」：${x.message}`);
  };
  statesOf = (kind: ScheduleEntry["kind"]) =>
    kind === "milestone" ? [["pending", "待達成"], ["achieved", "已達成"]] : [["open", "開放"], ["in-progress", "進行中"], ["completed", "完成"]];

  async toggleEvidence(id: string) {
    this.evidenceOpen = this.evidenceOpen === id ? null : id;
    if (this.workLoaded || !this.week()) return;
    this.workLoaded = true;
    try {
      const data = await firstValueFrom(this.http.get<{ results: Record<string, { items: WorkItem[] }> }>(`/api/weeks/${this.week()}/engineer-work`));
      this.work = Object.values(data.results ?? {}).flatMap((r) => r.items ?? []);
    } catch { /* 404 or unreadable: manual entry still works */ }
    this.changes.detectChanges();
  }
  unlinked = (e: ScheduleEntry) => this.work.filter((w) => !e.evidenceLinks?.some((l) => l.workId === w.workId));
  link(e: ScheduleEntry, workId: number) {
    if (!e.evidenceLinks?.some((l) => l.workId === workId)) (e.evidenceLinks ??= []).push({ workId, summary: "" });
  }
  unlink(e: ScheduleEntry, workId: number) { e.evidenceLinks = e.evidenceLinks?.filter((l) => l.workId !== workId); }

  has = (s: string) => !!this.project().participants?.includes(s);
  toggle(s: string) {
    const p = this.project();
    const list = p.participants ?? [];
    p.participants = list.includes(s) ? list.filter((x) => x !== s) : [...list, s];
  }

  add(kind: ScheduleEntry["kind"]) {
    const p = this.project();
    const blank = { baselineStart: null, baselineEnd: null, forecastStart: null, forecastEnd: null, actualStart: null, actualEnd: null };
    (p.schedule ??= []).push({ ...blank, id: crypto.randomUUID(), kind, name: "", state: kind === "milestone" ? "pending" : "open", predecessors: [] });
  }
  cancel(id: string) { this.replace(cancelEntry((this.project().schedule ?? []).map(toInput), id)); }
  reactivate(id: string) { this.replace(reactivateEntry((this.project().schedule ?? []).map(toInput), id)); }
  remove(id: string) {
    this.replace((this.project().schedule ?? []).filter((e) => e.id !== id).map((e) => ({ ...e, predecessors: e.predecessors?.filter((p) => p !== id), phaseId: e.phaseId === id ? null : e.phaseId })));
  }
  private replace(entries: ScheduleEntry[] | ScheduleInput[]) { this.project().schedule = entries as ScheduleEntry[]; }

  addDependency() {
    (this.project().externalDependencies ??= []).push({ id: crypto.randomUUID(), description: "", supplier: "", dueDate: "", status: "pending", linkedEntryIds: [] });
  }
  removeDependency(d: ExternalDependency) {
    const p = this.project();
    p.externalDependencies = (p.externalDependencies ?? []).filter((x) => x !== d);
  }
}
