import { ChangeDetectorRef, Component, inject, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { HttpClient } from "@angular/common/http";
import { ActivatedRoute } from "@angular/router";
import { firstValueFrom } from "rxjs";
import type { CrossFile, NonProjectSection, SectionFile, SectionItem } from "./report-types";

const SECTION_LABELS: Record<NonProjectSection, string> = {
  incidents: "重大系統異常",
  operations: "系統維護與營運",
  personnel: "人力與組織異動",
  technology: "新技術評估",
  appendix: "工程師工作明細與來源連結",
};
const FILE_LABELS: Record<string, string> = { s1: "第一課", s2: "第二課", s3: "第三課" };

@Component({
  standalone: true,
  imports: [FormsModule],
  template: `<header>
      <h1>處會週報 {{ week }}</h1>
      <span>{{ me?.name }} · {{ me?.role }}</span>
      <a href="#/">返回</a>
    </header>
    <main>
      @if (message) { <p class="message" role="status">{{ message }}</p> }
      @for (file of files; track file) {
        <section class="card" [attr.data-file]="file">
          <h2>{{ FILE_LABELS[file] }}@if (!canEdit(file)) { <small>（唯讀）</small> }</h2>
          @for (key of sectionKeys; track key) {
            <h3>{{ SECTION_LABELS[key] }}</h3>
            @for (item of itemsOf(file, key); track item.id) {
              <div class="item">
                <label>標題
                  <input data-field="title" [(ngModel)]="item.title" [disabled]="!canEdit(file)" /></label>
                @if (key === "personnel") {
                  <label>生效日期
                    <input type="date" [(ngModel)]="item.details.effectiveDate" [disabled]="!canEdit(file)" /></label>
                  <label>職責或系統交接
                    <textarea [(ngModel)]="item.details.handover" [disabled]="!canEdit(file)"></textarea></label>
                  <label>工作影響
                    <textarea [(ngModel)]="item.details.impact" [disabled]="!canEdit(file)"></textarea></label>
                  <label>下一步
                    <textarea [(ngModel)]="item.details.nextStep" [disabled]="!canEdit(file)"></textarea></label>
                } @else {
                  <label>內容
                    <textarea data-field="content" rows="6" [(ngModel)]="item.content" [disabled]="!canEdit(file)"></textarea></label>
                }
                @if (canEdit(file)) { <button type="button" (click)="remove(file, item)">刪除</button> }
              </div>
            }
            @if (canEdit(file)) { <button type="button" [attr.data-add]="key" (click)="add(file, key)">新增項目</button> }
          }
          @if (canEdit(file)) { <p><button type="button" data-save (click)="save(file)">儲存</button></p> }
        </section>
      }
      <section class="card" data-file="cross">
        <h2>跨課 <small>（唯讀）</small></h2>
        <p>{{ cross.managementSummary }}</p>
      </section>
    </main>`,
})
export class WeekEditor implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private changes = inject(ChangeDetectorRef);
  readonly SECTION_LABELS = SECTION_LABELS;
  readonly FILE_LABELS = FILE_LABELS;
  readonly sectionKeys = Object.keys(SECTION_LABELS) as NonProjectSection[];
  readonly files = ["s1", "s2", "s3"];
  week = "";
  me: { name: string; role: string; section: string | null } | null = null;
  data: Record<string, Partial<SectionFile & CrossFile>> = {};
  message = "";
  get cross() { return (this.data["cross"] ?? {}) as Partial<CrossFile>; }

  async ngOnInit() {
    this.week = this.route.snapshot.paramMap.get("week")!;
    this.me = await firstValueFrom(this.http.get<NonNullable<typeof this.me>>("/api/me"));
    this.data = await firstValueFrom(this.http.get<typeof this.data>(`/api/weeks/${this.week}`));
    for (const items of Object.values(this.data).map((d) => d.items ?? [])) for (const i of items) i.details ??= {};
    this.changes.detectChanges();
  }

  canEdit = (file: string) => this.me?.role === "Head" && this.me.section === file;
  itemsOf = (file: string, section: string): SectionItem[] => (this.data[file]?.items ?? []).filter((i) => i.section === section);

  add(file: string, section: NonProjectSection) {
    const data = (this.data[file] ??= {});
    (data.items ??= []).push({ id: crypto.randomUUID(), section, title: "", content: "", details: {} });
  }
  remove(file: string, item: SectionItem) {
    const data = this.data[file];
    if (data?.items) data.items = data.items.filter((i) => i !== item);
  }

  async save(file: string) {
    const body: SectionFile = { week: this.week, section: file, items: this.data[file]?.items ?? [] };
    try {
      await firstValueFrom(this.http.put(`/api/weeks/${this.week}/${file}`, body));
      this.message = "已儲存。";
    } catch (e: any) {
      this.message = `儲存失敗：${e?.error?.error ?? ""}`;
    }
    this.changes.detectChanges();
  }
}
