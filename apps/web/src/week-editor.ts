import { ChangeDetectorRef, Component, ElementRef, HostListener, inject, OnInit, viewChild } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { ActivatedRoute, CanDeactivateFn, Router, RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { CrossEditor } from "./cross-editor";
import { isDirty, snapshotOf } from "./dirty-state";
import { EDIT_FILES, tabsOf } from "./edit-nav";
import { FileView, pruneRefLinks } from "./file-view";
import { cleanSchedule, scheduleErrors } from "./project-schedule";
import { FILE_LABELS, SECTION_LABELS, type CrossFile, type SectionFile } from "./report-types";
import { ShellState } from "./shell-state";
import { weekStatus } from "./week-status";

const TAB_LABELS: Record<string, string> = { projects: "專案", ...SECTION_LABELS, summary: "管理摘要", decisions: "待決策事項" };
const RAIL_LABELS: Record<string, string> = { ...FILE_LABELS, cross: "跨課" };

/** Changing week or leaving the editor asks first when a file has unsaved changes; switching file or tab never does. */
export const leaveGuard: CanDeactivateFn<WeekEditor> = (editor, _route, _state, next) => editor.confirmLeave(next.url);

@Component({
  standalone: true,
  imports: [FileView, CrossEditor, RouterLink],
  template: `<div class="edit">
      <aside class="rail">
        <h3>{{ week }}</h3>
        <div role="tablist" aria-orientation="vertical" aria-label="課別">
          @for (f of EDIT_FILES; track f) {
            <a role="tab" [attr.data-rail-file]="f" [routerLink]="['/weeks', week, f, tabFor(f)]" [class.on]="f === file"
              [attr.aria-selected]="f === file" [attr.aria-current]="f === file ? 'page' : null">{{ RAIL_LABELS[f] }}@if (!canEditFile(f)) { <span class="ro">唯讀</span> }@if (dirty(f)) { <span class="dot" data-dirty role="img" aria-label="有未儲存變更"></span> }</a>
          }
        </div>
      </aside>
      <main class="page" (input)="error = ''" (change)="error = ''">
        <div class="page-head">
          <h1>{{ RAIL_LABELS[file] }}</h1>
          @if (!canEditFile(file)) { <span class="lock" data-readonly-note>🔒 唯讀。這一頁由{{ file === "cross" ? "部級主管" : RAIL_LABELS[file] + "課長" }}編輯。</span> }
        </div>
        <div class="tabs" role="tablist" aria-label="分項">
          @for (t of tabsOf(file); track t) {
            <a role="tab" [attr.data-tab]="t" [routerLink]="['/weeks', week, file, t]" [class.on]="t === tab"
              [attr.aria-selected]="t === tab" [attr.aria-current]="t === tab ? 'page' : null">{{ TAB_LABELS[t] }}@if (count(t) !== null) { <em>{{ count(t) }}</em> }</a>
          }
        </div>
        @if (!loaded) {
          <p role="status">載入中…</p>
        } @else if (file === "cross") {
          <app-cross-editor [cross]="cross" [tab]="tab" [editable]="canEditCross()" />
        } @else {
          <app-file-view [file]="file" [tab]="tab" [week]="week" [data]="fileData(file)" [editable]="canEdit(file)" />
        }
      </main>
      @if (canEditFile(file) || canEditCross()) {
        <div class="bar-save" data-save-bar>
          <span class="st" [class.dirty]="dirty(file)" [attr.data-save-state]="dirty(file) ? 'dirty' : 'clean'">{{ dirty(file) ? "● 有未儲存變更" : "所有變更已儲存" }}</span>
          @if (error && errorFile === file) { <span class="err" role="alert">{{ error }}</span> }
          <span class="sp"></span>
          @if (canEditCross()) {
            @if (dirty("cross")) { <span class="st" data-publish-hint>請先儲存跨課</span> }
            <button type="button" data-publish [disabled]="publishing || dirty('cross')" (click)="askPublish()">{{ publishing ? "發布中…" : "發布 " + week }}</button>
          }
          @if (canEditFile(file)) {
            <button type="button" data-save [disabled]="!dirty(file)" (click)="file === 'cross' ? saveCross() : save(file)">儲存{{ RAIL_LABELS[file] }}</button>
          }
        </div>
      }
      <dialog #publishDialog data-publish-dialog aria-label="發布確認">
        <form method="dialog">
          <p>發布 {{ week }} 為 v{{ nextVersion() }}？發布後無法修改。</p>
          <button value="cancel" autofocus>取消</button>
          <button value="publish" data-publish-confirm>確認發布</button>
        </form>
      </dialog>
      <dialog #leave data-leave-dialog aria-label="離開確認">
        <form method="dialog">
          <p>有未儲存變更，確定要離開？離開後這些變更會遺失。</p>
          <button value="stay" autofocus>留在此頁</button>
          <button value="leave" data-leave-confirm>離開並捨棄</button>
        </form>
      </dialog>
    </div>`,
})
export class WeekEditor implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private changes = inject(ChangeDetectorRef);
  private state = inject(ShellState);
  readonly EDIT_FILES = EDIT_FILES;
  readonly RAIL_LABELS = RAIL_LABELS;
  readonly TAB_LABELS = TAB_LABELS;
  readonly tabsOf = tabsOf;
  week = "";
  file = "";
  tab = "";
  loaded = false;
  data: Record<string, Partial<SectionFile & CrossFile>> = {};
  error = "";
  errorFile = "";
  /** Per-file snapshot of what was last loaded or saved; a file is dirty when its draft differs. */
  private saved: Record<string, string> = {};
  publishing = false;
  private publishDialog = viewChild.required<ElementRef<HTMLDialogElement>>("publishDialog");
  private leaveDialog = viewChild.required<ElementRef<HTMLDialogElement>>("leave");
  get me() { return this.state.me(); }
  get cross(): CrossFile {
    const c = (this.data["cross"] ??= {}) as Partial<CrossFile>;
    c.managementSummary ??= "";
    return (c.pendingDecisions ??= [], c) as CrossFile;
  }
  fileData = (file: string) => (this.data[file] ??= {});

  /** Same component instance serves every week/file/tab, so follow the params; reload only when the week changes. */
  ngOnInit() {
    this.route.paramMap.subscribe((p) => {
      this.file = p.get("file")!;
      this.tab = p.get("tab")!;
      if (p.get("week") !== this.week) {
        this.week = p.get("week")!;
        this.error = "";
        void this.load();
      }
    });
  }

  private async load() {
    const week = this.week;
    this.loaded = false;
    const data = await firstValueFrom(this.http.get<typeof this.data>(`/api/weeks/${week}`));
    if (week !== this.week) return;
    for (const items of Object.values(data).map((d) => d.items ?? [])) for (const i of items) i.details ??= {};
    this.data = data;
    this.saved = Object.fromEntries(EDIT_FILES.map((f) => [f, snapshotOf(this.payload(f))]));
    this.loaded = true;
    this.changes.detectChanges();
  }

  /** What a save would send for the file, defaults filled so a never-touched file equals its snapshot. */
  private payload(file: string) {
    const d = this.data[file];
    return file === "cross" ? { managementSummary: d?.managementSummary ?? "", pendingDecisions: d?.pendingDecisions ?? [] } : { items: d?.items ?? [] };
  }
  dirty = (file: string) => this.loaded && isDirty(this.payload(file), this.saved[file]);
  private anyDirty = () => EDIT_FILES.some(this.dirty);

  confirmLeave(nextUrl: string): boolean | Promise<boolean> {
    const base = `/weeks/${this.week}`;
    const path = nextUrl.split(/[?#]/)[0];
    if (path === base || path.startsWith(`${base}/`) || !this.anyDirty()) return true;
    const dialog = this.leaveDialog().nativeElement;
    if (dialog.open) return false;
    dialog.returnValue = "";
    return new Promise((resolve) => {
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "leave"), { once: true });
      dialog.showModal();
    });
  }

  @HostListener("window:beforeunload", ["$event"])
  warnOnClose(event: BeforeUnloadEvent) {
    if (this.anyDirty()) event.preventDefault();
  }

  private fail(file: string, message: string) {
    this.error = message;
    this.errorFile = file;
    this.changes.detectChanges();
  }

  /** Switching file keeps the current tab when the new file has it. */
  tabFor = (file: string) => (tabsOf(file).includes(this.tab) ? this.tab : tabsOf(file)[0]);
  count(tab: string): number | null {
    if (!this.loaded) return null;
    if (this.file === "cross") return tab === "decisions" ? this.cross.pendingDecisions.length : null;
    return this.data[this.file]?.items?.filter((i) => i.section === tab).length ?? 0;
  }

  canEditFile = (file: string) => (file === "cross" ? this.canEditCross() : this.canEdit(file));
  canEdit = (file: string) => this.me?.role === "Head" && this.me.section === file;
  canEditCross = () => this.me?.role === "Division";
  async saveCross() {
    const { managementSummary, pendingDecisions } = this.cross;
    await this.put("cross", { week: this.week, managementSummary, pendingDecisions });
  }
  nextVersion = () => weekStatus(this.state.publications(), this.week).version + 1;

  askPublish() {
    const dialog = this.publishDialog().nativeElement;
    dialog.returnValue = "";
    dialog.addEventListener("close", () => dialog.returnValue === "publish" && void this.publish(), { once: true });
    dialog.showModal();
  }

  private async publish() {
    if (this.publishing) return;
    this.publishing = true;
    this.error = "";
    this.changes.detectChanges();
    try {
      const entry = await firstValueFrom(this.http.post<{ week: string; version: number }>(`/api/weeks/${this.week}/publications`, {}));
      await this.router.navigate(["/publications", entry.week, entry.version]);
    } catch (e: any) {
      this.publishing = false;
      this.fail(this.file, `發布失敗：${e?.error?.error ?? ""}`);
    }
  }

  async save(file: string) {
    const errors = (this.data[file]?.items ?? []).flatMap(scheduleErrors);
    if (errors.length) return this.fail(file, `時程有誤，未儲存：${errors.join("；")}`);
    for (const i of this.data[file]?.items ?? []) pruneRefLinks(i);
    const items = (this.data[file]?.items ?? []).map((i) => (i.schedule ? { ...i, schedule: cleanSchedule(i.schedule) } : i));
    const body: SectionFile = { week: this.week, section: file, items };
    await this.put(file, body);
  }

  private async put(file: string, body: SectionFile | CrossFile) {
    const week = this.week;
    const sent = snapshotOf(this.payload(file));
    this.error = "";
    try {
      await firstValueFrom(this.http.put(`/api/weeks/${week}/${file}`, body));
    } catch (e: any) {
      return this.fail(file, `儲存失敗：${e?.error?.error ?? ""}`);
    }
    if (week === this.week) this.saved[file] = sent;
    this.state.flash(`已儲存${RAIL_LABELS[file]}`);
    this.changes.detectChanges();
  }
}
