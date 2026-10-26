import { ChangeDetectorRef, Component, ElementRef, inject, input, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { FormsModule } from "@angular/forms";
import { firstValueFrom } from "rxjs";
import { DateRangePicker } from "./date-range-picker";
import { Gantt } from "./gantt";
import { forecastError, gridRows, hasChildTasks, isPhaseOpen, moveTask, type TaskDrop } from "./gantt-model";
import { ProjectHeader } from "./project-header";
import { PredecessorSelect } from "./predecessor-select";
import { clampProgress, liveTasksOf, progressText } from "./project-progress";
import { cancelEntry, evaluateSchedule, reactivateEntry, type ScheduleInput } from "./schedule-rules";
import type { ExternalDependency, ScheduleEntry, SectionItem } from "./report-types";

const KEYS: (keyof ScheduleEntry)[] = [
  "id", "kind", "name", "owner", "phaseId", "state", "planStart", "planEnd",
  "progress", "forecastEnd", "actualStart", "actualEnd", "planDate", "actualDate", "predecessors", "evidenceLinks",
];
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
  const title = project.title || "未命名專案";
  const forecast = entries.flatMap((e) => forecastError(e) ?? []).map((m, i) => `「${title}」${m}`);
  return [...evaluateSchedule(entries.map(toInput)).errors.map((x) => `「${title}」${name(x.entryId)} ← ${name(x.predecessorId)}：${x.message}`), ...forecast];
}

@Component({
  selector: "app-project-schedule",
  standalone: true,
  imports: [FormsModule, Gantt, ProjectHeader, DateRangePicker, PredecessorSelect],
  template: `
    <!-- the app refreshes views manually (no zone events), so re-render after any edit bubbling up -->
    <div class="project" [class.doc-project]="document()" [class.invalid]="invalid()" [attr.data-project-error]="invalid() ? '' : null" [attr.data-project]="project().id" (input)="changes.detectChanges()" (change)="changes.detectChanges()" (click)="changes.detectChanges()">
      <app-project-header [project]="project()" [editable]="editable()" [document]="document()" [baseDate]="baseDate()" />

      <app-gantt [baseDate]="baseDate()" [entries]="evaluated().entries" [phasesOpen]="!document()" [selectedId]="selectedId()" (entrySelected)="selectFromGantt($event)" [(expandTasks)]="expandTasks" [(phaseToggles)]="phaseToggles" />

      @if (!document()) {
      <details class="sched" open>
        <summary>時程明細（{{ project().schedule?.length || 0 }} 項）</summary>
        <div class="grid-scroll" data-schedule-grid>
        <table class="grid sched-grid">
          <thead><tr><th>類型</th><th>名稱</th><th>負責</th><th>狀態</th><th>進度</th><th>計畫起訖</th><th>實際起訖</th><th>預估完工</th><th>前置項目</th><th>操作</th></tr></thead>
          <tbody>
            @for (e of rows(); track e.id) {
              <tr class="entry" [attr.data-entry]="e.name" [attr.data-entry-id]="e.id" [class.cancelled]="e.state === 'cancelled'" [class.is-child]="e.kind === 'task' && !!e.phaseId" [class.row-selected]="e.id === selectedId()" [class.drag-src]="e.id === dragId()" [class.drop-before]="hint()?.id === e.id && hint()?.pos === 'before'" [class.drop-after]="hint()?.id === e.id && hint()?.pos === 'after'" [class.drop-into]="hint()?.id === e.id && hint()?.pos === 'into'" (click)="selectFromGrid($event, e.id)" (dragover)="dragOver($event, e)" (dragleave)="hint.set(null)" (drop)="dropOn($event, e)">
                <td class="kind-cell">
                  @if (e.kind === 'task' && editable()) { <span class="drag-handle" draggable="true" title="拖拉調整歸屬與順序" aria-label="拖拉調整歸屬與順序" (dragstart)="dragStart($event, e.id)" (dragend)="dragEnd()">⋮⋮</span> }
                  @if (e.kind === 'phase' && hasChildren(e.id)) {
                    <button type="button" class="grid-phase-toggle" [attr.aria-expanded]="isOpen(e.id)" [attr.aria-label]="isOpen(e.id) ? '收合此階段任務' : '展開此階段任務'" (click)="togglePhase(e.id)">{{ isOpen(e.id) ? '▼' : '▶' }}</button>
                  }
                  <strong class="entry-kind" [attr.data-kind]="e.kind">{{ KIND_LABELS[e.kind] }}</strong>
                </td>
                <td class="name-cell">
                  <input data-field="entry-name" aria-label="名稱" [(ngModel)]="e.name" [disabled]="!editable() || e.state === 'cancelled'" />
                </td>
                <td>@if (e.kind === 'task') { <input aria-label="負責人/單位" [(ngModel)]="e.owner" [disabled]="!editable()" /> }</td>
                <td>
                  @if (e.state !== 'cancelled') {
                    <select aria-label="狀態" [ngModel]="e.state" (ngModelChange)="setState(e, $event)" [disabled]="!editable()">
                      @for (s of statesOf(e.kind); track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
                    </select>
                  } @else { <span class="num">已取消</span> }
                </td>
                <td>
                  @if (e.kind !== 'milestone' && e.state !== 'cancelled') {
                    @if (editable() && e.state === 'in-progress' && !hasLiveChildren(e)) {
                      <input type="number" min="0" max="100" step="1" aria-label="進度" data-field="entry-progress" [ngModel]="e.progress ?? null" (ngModelChange)="e.progress = clamp($event)" />
                    } @else { <span class="num" data-progress-text>{{ progressOf(e) }}</span> }
                  }
                </td>
                @if (e.kind === 'milestone') {
                  <td><app-date-range-picker [compact]="true" mode="single" data-field="planDate" ariaLabel="計畫日期" [value]="e.planDate ?? null" (valueChange)="e.planDate = $event" [disabled]="!editable() || e.state === 'cancelled'" /></td>
                  <td><app-date-range-picker [compact]="true" mode="single" data-field="actualDate" ariaLabel="實際日期" [value]="e.actualDate ?? null" (valueChange)="e.actualDate = $event" [disabled]="!editable() || e.state === 'cancelled'" /></td>
                } @else {
                  <td><app-date-range-picker [compact]="true" data-field="planRange" ariaLabel="計畫起訖" [(startDate)]="e.planStart" [(endDate)]="e.planEnd" [disabled]="!editable() || e.state === 'cancelled'" /></td>
                  <td><app-date-range-picker [compact]="true" data-field="actualRange" ariaLabel="實際起訖" [(startDate)]="e.actualStart" [(endDate)]="e.actualEnd" [disabled]="!editable() || e.state === 'cancelled'" /></td>
                }
                <td>
                  @if (e.kind === 'task' && (e.state === 'open' || e.state === 'in-progress')) {
                    <input type="date" data-field="forecastEnd" aria-label="預估完工日" [ngModel]="e.forecastEnd ?? ''" (ngModelChange)="e.forecastEnd = $event || undefined" [disabled]="!editable()" />
                  }
                </td>
                <td>
                  @if (e.state !== 'cancelled') {
                    <app-predecessor-select data-field="predecessors" [options]="optionsFor(e)" [selected]="e.predecessors ?? NONE" (selectedChange)="e.predecessors = $event" [disabled]="!editable()" />
                  }
                </td>
                <td>
                  @if (editable()) {
                    <div class="entry-actions">
                      @if (e.kind === 'task' && e.state !== 'cancelled') {
                        <button type="button" data-evidence-toggle title="佐證" aria-label="佐證" (click)="toggleEvidence(e.id)"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.5 5.5 6 10a1.4 1.4 0 0 0 2 2l5-5a3 3 0 0 0-4.2-4.2L4 7.6a4.6 4.6 0 0 0 6.5 6.5"/></svg><span class="num">{{ e.evidenceLinks?.length || 0 }}</span></button>
                      }
                      @if (e.kind === 'phase' && e.state !== 'cancelled') { <button type="button" data-add-task title="＋任務" aria-label="＋任務" (click)="addTask(e.id)"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3v10M3 8h10"/></svg></button> }
                      @if (e.state === 'cancelled') { <button type="button" title="重新啟用" aria-label="重新啟用" (click)="reactivate(e.id)"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8a5 5 0 1 0 1.8-3.8M3 2.5v3h3"/></svg></button> }
                      @else { <button type="button" title="取消項目" aria-label="取消項目" (click)="cancel(e.id)"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="5.5"/><path d="m4 4 8 8"/></svg></button> }
                      <button type="button" title="刪除" aria-label="刪除" (click)="remove(e.id)"><svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5"/></svg></button>
                    </div>
                  }
                </td>
              </tr>
              @if (editable() && e.kind === 'task' && e.state !== 'cancelled' && evidenceOpen === e.id) {
                <tr class="evidence-row"><td colspan="10">
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
                </td></tr>
              }
              @for (msg of entryErrors(e.id); track msg) { <tr class="error-row"><td colspan="10"><p class="error" role="alert">{{ msg }}</p></td></tr> }
            }
          </tbody>
        </table>
        @if (dragId()) { <div class="drop-direct" [class.drop-over]="hint()?.id === 'direct'" data-drop-direct (dragover)="directOver($event)" (dragleave)="hint.set(null)" (drop)="dropDirect($event)">拖到這裡：專案直屬</div> }
        </div>
        @if (editable()) {
          <p>
            @for (k of KINDS; track k) { <button type="button" [attr.data-add-entry]="k" (click)="add(k)">新增{{ KIND_LABELS[k] }}</button> }
          </p>
        }
      </details>

      <details class="sched" data-deliveries>
        <summary>外部交付（{{ project().externalDependencies?.length || 0 }} 項）</summary>
        <table class="grid">
          <thead><tr><th>內容</th><th>供應者</th><th>到期日</th><th>狀態</th><th>關聯時程項目</th><th></th></tr></thead>
          <tbody>
            @for (d of project().externalDependencies; track d.id) {
              <tr data-dependency>
                <td><input data-field="dep-description" aria-label="內容" [(ngModel)]="d.description" [disabled]="!editable()" /></td>
                <td><input data-field="dep-supplier" aria-label="供應者" [(ngModel)]="d.supplier" [disabled]="!editable()" /></td>
                <td><input type="date" data-field="dep-due" aria-label="到期日" [(ngModel)]="d.dueDate" [disabled]="!editable()" /></td>
                <td>
                  <select data-field="dep-status" aria-label="狀態" [(ngModel)]="d.status" [disabled]="!editable()">
                    <option value="pending">未交付</option><option value="delivered">已交付</option>
                  </select></td>
                <td>
                  <select multiple data-field="dep-links" aria-label="關聯時程項目" [(ngModel)]="d.linkedEntryIds" [disabled]="!editable()">
                    @for (o of project().schedule; track o.id) { <option [value]="o.id">{{ o.name }}</option> }
                  </select></td>
                <td>@if (editable()) { <button type="button" data-remove-dependency (click)="removeDependency(d)">刪除</button> }</td>
              </tr>
            } @empty {
              <tr><td colspan="6" class="empty-row">尚無外部交付</td></tr>
            }
          </tbody>
        </table>
        @if (editable()) { <button type="button" data-add-dependency (click)="addDependency()">新增外部交付</button> }
      </details>
      }

      @if (document()) {
        @if (project().externalDependencies?.length) {
          <table class="grid doc-deliveries" data-deliveries-table>
            <caption>外部交付</caption>
            <thead><tr><th>內容</th><th>供應者</th><th>到期日</th><th>狀態</th></tr></thead>
            <tbody>
              @for (d of project().externalDependencies; track d.id) {
                <tr data-dependency><td>{{ d.description }}</td><td>{{ d.supplier }}</td><td class="num">{{ d.dueDate }}</td><td>{{ d.status === "delivered" ? "已交付" : "未交付" }}</td></tr>
              }
            </tbody>
          </table>
        }
      }
    </div>`,
})
export class ProjectSchedule {
  protected changes = inject(ChangeDetectorRef);
  private http = inject(HttpClient);
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  project = input.required<SectionItem>();
  week = input("");
  evidenceOpen: string | null = null;
  manualId: number | null = null;
  work: WorkItem[] = [];
  private workLoaded = false;
  editable = input(false);
  /** Publication layout: title line, gantt and a read-only deliveries table; no schedule forms. */
  document = input(false);
  /** 基準日 override (publish date); unset = today. */
  baseDate = input<string>();
  readonly KIND_LABELS = KIND_LABELS;
  readonly KINDS = ["phase", "task", "milestone"] as const;
  readonly NONE: string[] = [];
  /** Phase open state is shared by the gantt and the grid; the editor opens phases by default, the document does not. */
  expandTasks = signal(false);
  phaseToggles = signal<ReadonlySet<string>>(new Set());
  isOpen = (phaseId: string) => isPhaseOpen({ expandTasks: this.expandTasks(), defaultOpen: !this.document(), toggled: this.phaseToggles() }, phaseId);
  /** One highlighted entry, shared by the gantt row and the grid row. */
  selectedId = signal<string | null>(null);
  selectFromGrid(ev: Event, id: string) {
    if (!(ev.target as HTMLElement).closest("input, select, button, textarea, app-date-range-picker, app-predecessor-select")) this.selectedId.set(id);
  }
  selectFromGantt(id: string) {
    this.selectedId.set(id);
    const entry = (this.project().schedule ?? []).find((e) => e.id === id);
    if (entry?.kind === "task" && entry.phaseId && !this.isOpen(entry.phaseId)) this.togglePhase(entry.phaseId);
    this.changes.detectChanges();
    this.host.nativeElement.querySelector(`tr[data-entry-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }
  /** Task drag: only the handle drags; rows and the bottom zone are drop targets. */
  dragId = signal<string | null>(null);
  hint = signal<{ id: string; pos: "before" | "after" | "into" } | null>(null);
  dragStart(ev: DragEvent, id: string) {
    ev.dataTransfer?.setData("text/plain", id);
    const row = (ev.target as HTMLElement).closest("tr");
    if (row) ev.dataTransfer?.setDragImage(row, 0, 0);
    this.dragId.set(id);
    this.changes.detectChanges();
  }
  dragEnd() { this.dragId.set(null); this.hint.set(null); this.changes.detectChanges(); }
  private dropFor(ev: DragEvent, e: ScheduleEntry): { drop: TaskDrop; pos: "before" | "after" | "into" } | null {
    const src = this.dragId();
    if (!src || src === e.id) return null;
    if (e.kind === "phase") return e.state === "cancelled" ? null : { drop: { intoPhase: e.id }, pos: "into" };
    if (e.kind !== "task") return null;
    const owner = (this.project().schedule ?? []).find((x) => x.id === e.phaseId);
    if (owner?.state === "cancelled") return null; // a cancelled phase cannot receive tasks
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    const pos = ev.clientY < r.top + r.height / 2 ? "before" : "after";
    return { drop: pos === "before" ? { before: e.id } : { after: e.id }, pos };
  }
  dragOver(ev: DragEvent, e: ScheduleEntry) {
    const d = this.dropFor(ev, e);
    if (!d) return;
    ev.preventDefault();
    const cur = this.hint();
    if (cur?.id !== e.id || cur.pos !== d.pos) { this.hint.set({ id: e.id, pos: d.pos }); this.changes.detectChanges(); }
  }
  dropOn(ev: DragEvent, e: ScheduleEntry) {
    const d = this.dropFor(ev, e);
    if (d) { ev.preventDefault(); this.applyDrop(d.drop); }
  }
  directOver(ev: DragEvent) { ev.preventDefault(); this.hint.set({ id: "direct", pos: "into" }); this.changes.detectChanges(); }
  dropDirect(ev: DragEvent) { ev.preventDefault(); this.applyDrop({ direct: true }); }
  private applyDrop(drop: TaskDrop) {
    const id = this.dragId()!;
    this.replace(moveTask(this.project().schedule ?? [], id, drop));
    const moved = (this.project().schedule ?? []).find((e) => e.id === id);
    if (moved?.phaseId && !this.isOpen(moved.phaseId)) this.togglePhase(moved.phaseId);
    this.dragEnd();
    this.selectedId.set(id);
    this.changes.detectChanges();
    this.host.nativeElement.querySelector(`tr[data-entry-id="${id}"]`)?.scrollIntoView({ block: "nearest" });
  }
  rows = () => gridRows(this.project().schedule ?? [], this.isOpen);
  hasChildren = (phaseId: string) => hasChildTasks(this.project().schedule ?? [], phaseId, true);
  togglePhase(phaseId: string) {
    const next = new Set(this.phaseToggles());
    if (!next.delete(phaseId)) next.add(phaseId);
    this.phaseToggles.set(next);
  }

  // ngModel mutates entries in place, so memoize on content: a fresh array per check would trip NG0100.
  private memo?: { key: string; value: ReturnType<typeof evaluateSchedule> };
  evaluated = () => {
    const p = this.project();
    const key = JSON.stringify([p.schedule, p.externalDependencies, this.baseDate()]);
    if (this.memo?.key !== key) this.memo = { key, value: evaluateSchedule((p.schedule ?? []).map(toInput), toDeliveries(p), this.baseDate()) };
    return this.memo.value;
  };
  invalid = () => this.evaluated().errors.length > 0 || (this.project().schedule ?? []).some((e) => !!forecastError(e));
  others = (e: ScheduleEntry) => (this.project().schedule ?? []).filter((o) => o.id !== e.id && o.state !== "cancelled");
  // option arrays are input bindings, so keep identity stable until names/ids actually change (NG0100).
  private optionCache = new Map<string, { key: string; value: ScheduleEntry[] }>();
  optionsFor(e: ScheduleEntry) {
    const value = this.others(e);
    const key = JSON.stringify(value.map((o) => [o.id, o.name]));
    const hit = this.optionCache.get(e.id);
    if (hit?.key === key) return hit.value;
    this.optionCache.set(e.id, { key, value });
    return value;
  }
  entryErrors = (id: string) => {
    const entries = this.project().schedule ?? [];
    const name = (x: string) => entries.find((e) => e.id === x)?.name || x;
    const own = entries.find((e) => e.id === id);
    return [...this.evaluated().errors.filter((x) => x.entryId === id).map((x) => `前置項目「${name(x.predecessorId)}」：${x.message}`), ...(own ? [forecastError(own)] : []).flatMap((m) => m ?? [])];
  };
  clamp = clampProgress;
  progressOf = (e: ScheduleEntry) => progressText(this.project().schedule ?? [], e);
  hasLiveChildren = (e: ScheduleEntry) => e.kind === "phase" && liveTasksOf(this.project().schedule ?? [], e).length > 0;
  setState(e: ScheduleEntry, state: ScheduleEntry["state"]) {
    if (e.state === state) return;
    e.state = state;
    if (state === "completed") e.forecastEnd = undefined; // 預估完工日 only means something until the item is done
    e.progress = undefined; // progress only means something while in progress; a new state starts blank
  }
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

  add(kind: ScheduleEntry["kind"], phaseId: string | null = null) {
    const p = this.project();
    const blank = { planStart: null, planEnd: null, actualStart: null, actualEnd: null };
    const id = crypto.randomUUID();
    (p.schedule ??= []).push({ ...blank, id, kind, name: "", state: kind === "milestone" ? "pending" : "open", predecessors: [], ...(kind === "task" && { phaseId }) });
    return id;
  }
  /** Adds a task under the phase, opens the phase and focuses the new name field. */
  addTask(phaseId: string) {
    const id = this.add("task", phaseId);
    if (!this.isOpen(phaseId)) this.togglePhase(phaseId);
    this.changes.detectChanges();
    this.host.nativeElement.querySelector<HTMLInputElement>(`[data-entry-id="${id}"] [data-field="entry-name"]`)?.focus();
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
