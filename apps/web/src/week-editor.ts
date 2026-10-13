import { ChangeDetectorRef, Component, inject, OnInit } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { ActivatedRoute, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { CrossEditor } from "./cross-editor";
import { FileView } from "./file-view";
import { cleanSchedule, scheduleErrors } from "./project-schedule";
import type { CrossFile, SectionFile } from "./report-types";

@Component({
  standalone: true,
  imports: [FileView, CrossEditor],
  template: `<header>
      <h1>處會週報 {{ week }}</h1>
      <span>{{ me?.name }} · {{ me?.role }}</span>
      <a href="#/">返回</a>
      @if (canEditCross()) { <button type="button" data-publish (click)="publish()">發布</button> }
    </header>
    <main>
      @if (message) { <p class="message" role="status">{{ message }}</p> }
      @for (file of files; track file) {
        <app-file-view [file]="file" [week]="week" [data]="fileData(file)" [editable]="canEdit(file)" (save)="save(file)" />
      }
      <app-cross-editor [cross]="cross" [editable]="canEditCross()" (save)="saveCross()" />
    </main>`,
})
export class WeekEditor implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private changes = inject(ChangeDetectorRef);
  readonly files = ["s1", "s2", "s3"];
  week = "";
  me: { name: string; role: string; section: string | null } | null = null;
  data: Record<string, Partial<SectionFile & CrossFile>> = {};
  message = "";
  get cross(): CrossFile {
    const c = (this.data["cross"] ??= {}) as Partial<CrossFile>;
    c.managementSummary ??= "";
    return (c.pendingDecisions ??= [], c) as CrossFile;
  }
  fileData = (file: string) => (this.data[file] ??= {});

  async ngOnInit() {
    this.week = this.route.snapshot.paramMap.get("week")!;
    this.me = await firstValueFrom(this.http.get<NonNullable<typeof this.me>>("/api/me"));
    this.data = await firstValueFrom(this.http.get<typeof this.data>(`/api/weeks/${this.week}`));
    for (const items of Object.values(this.data).map((d) => d.items ?? [])) for (const i of items) i.details ??= {};
    this.changes.detectChanges();
  }

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
