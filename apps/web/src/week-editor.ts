import { ChangeDetectorRef, Component, inject, OnInit } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { CrossEditor } from "./cross-editor";
import { EDIT_FILES, tabsOf } from "./edit-nav";
import { FileView } from "./file-view";
import { cleanSchedule, scheduleErrors } from "./project-schedule";
import { FILE_LABELS, SECTION_LABELS, type CrossFile, type SectionFile } from "./report-types";
import { ShellState } from "./shell-state";

const TAB_LABELS: Record<string, string> = { projects: "專案", ...SECTION_LABELS, summary: "管理摘要", decisions: "待決策事項" };
const RAIL_LABELS: Record<string, string> = { ...FILE_LABELS, cross: "跨課" };

@Component({
  standalone: true,
  imports: [FileView, CrossEditor, RouterLink],
  template: `<div class="edit">
      <aside class="rail">
        <h3>{{ week }}</h3>
        <div role="tablist" aria-orientation="vertical" aria-label="課別">
          @for (f of EDIT_FILES; track f) {
            <a role="tab" [attr.data-rail-file]="f" [routerLink]="['/weeks', week, f, tabFor(f)]" [class.on]="f === file"
              [attr.aria-selected]="f === file" [attr.aria-current]="f === file ? 'page' : null">{{ RAIL_LABELS[f] }}@if (!canEditFile(f)) { <span class="ro">唯讀</span> }</a>
          }
        </div>
      </aside>
      <main class="page">
        <div class="page-head">
          <h1>{{ RAIL_LABELS[file] }}</h1>
          @if (!canEditFile(file)) { <span class="lock" data-readonly-note>🔒 唯讀。這一頁由{{ file === "cross" ? "部級主管" : RAIL_LABELS[file] + "課長" }}編輯。</span> }
          @if (canEditCross()) { <button type="button" data-publish (click)="publish()">發布</button> }
        </div>
        <div class="tabs" role="tablist" aria-label="分項">
          @for (t of tabsOf(file); track t) {
            <a role="tab" [attr.data-tab]="t" [routerLink]="['/weeks', week, file, t]" [class.on]="t === tab"
              [attr.aria-selected]="t === tab" [attr.aria-current]="t === tab ? 'page' : null">{{ TAB_LABELS[t] }}@if (count(t) !== null) { <em>{{ count(t) }}</em> }</a>
          }
        </div>
        @if (message) { <p class="message" role="status">{{ message }}</p> }
        @if (!loaded) {
          <p role="status">載入中…</p>
        } @else if (file === "cross") {
          <app-cross-editor [cross]="cross" [tab]="tab" [editable]="canEditCross()" (save)="saveCross()" />
        } @else {
          <app-file-view [file]="file" [tab]="tab" [week]="week" [data]="fileData(file)" [editable]="canEdit(file)" (save)="save(file)" />
        }
      </main>
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
  message = "";
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
        this.message = "";
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
    this.loaded = true;
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
  async publish() {
    try {
      const entry = await firstValueFrom(this.http.post<{ week: string; version: number }>(`/api/weeks/${this.week}/publications`, {}));
      await this.router.navigate(["/publications", entry.week, entry.version]);
    } catch (e: any) {
      this.message = `發布失敗：${e?.error?.error ?? ""}`;
      this.changes.detectChanges();
    }
  }

  async save(file: string) {
    const items = (this.data[file]?.items ?? []).map((i) => (i.schedule ? { ...i, schedule: cleanSchedule(i.schedule) } : i));
    const errors = items.flatMap(scheduleErrors);
    if (errors.length) {
      this.message = `時程有誤，未儲存：${errors.join("；")}`;
      this.changes.detectChanges();
      return;
    }
    const body: SectionFile = { week: this.week, section: file, items };
    await this.put(file, body);
  }

  private async put(file: string, body: SectionFile | CrossFile) {
    try {
      await firstValueFrom(this.http.put(`/api/weeks/${this.week}/${file}`, body));
      this.message = "已儲存。";
    } catch (e: any) {
      this.message = `儲存失敗：${e?.error?.error ?? ""}`;
    }
    this.changes.detectChanges();
  }
}
