import { ChangeDetectorRef, Component, computed, inject, input } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { FormsModule } from "@angular/forms";
import { firstValueFrom } from "rxjs";
import type { EngineerFile, EngineerWork } from "./engineer-progress";
import { pickerList } from "./engineer-model";
import { ProjectSchedule } from "./project-schedule";
import { type NonProjectSection, type SourceLink, type SectionFile, type SectionItem } from "./report-types";
import { boundWorkIds, canBind, deltaText, itemFromWork } from "./work-binding";

/** Rows without a URL are dropped on save; an emptied list leaves no field behind. */
export function pruneRefLinks(item: SectionItem) {
  const links = item.details?.sourceLinks?.map((l) => ({ ...l, url: l.url?.trim() })).filter((l) => l.url);
  if (links?.length) item.details.sourceLinks = links;
  else delete item.details?.sourceLinks;
}

@Component({
  selector: "app-file-view",
  standalone: true,
  imports: [FormsModule, ProjectSchedule],
  template: `<section [attr.data-file]="file()">
      @if (tab() === "projects") {
        @for (p of itemsOf("projects"); track p.id) {
          <app-project-schedule [week]="week()" [file]="file()" [all]="all()" [baseline]="baseline()" [project]="p" [editable]="editable()" />
          @if (editable()) { <button type="button" (click)="remove(p)">刪除專案</button> }
        } @empty {
          <div class="empty" data-empty>{{ editable() ? "尚無專案，按下方「新增專案」開始。" : "尚無專案" }}</div>
        }
        @if (editable()) { <button type="button" data-add-project (click)="addProject()">新增專案</button> }
      } @else {
        @for (item of itemsOf(tab()); track item.id) {
          <div class="item">
            <label>標題
              <input data-field="title" [(ngModel)]="item.title" [disabled]="!editable()" /></label>
            @if (key() === "personnel") {
              <label>生效日期
                <input type="date" [(ngModel)]="item.details.effectiveDate" [disabled]="!editable()" /></label>
              <label>職責或系統交接
                <textarea [(ngModel)]="item.details.handover" [disabled]="!editable()"></textarea></label>
              <label>工作影響
                <textarea [(ngModel)]="item.details.impact" [disabled]="!editable()"></textarea></label>
              <label>下一步
                <textarea [(ngModel)]="item.details.nextStep" [disabled]="!editable()"></textarea></label>
            } @else {
              <label>內容
                <textarea data-field="content" rows="6" [(ngModel)]="item.content" [disabled]="!editable()"></textarea></label>
            }
            @if (item.workId != null) {
              <p class="num" data-bound-work>來源 #{{ item.workId }}・工程師狀態 {{ item.engineerStatus }}・進度 {{ item.engineerProgress }}%@if (deltaText(item.workId, item.engineerProgress, baseline()); as d) { <strong data-progress-delta>（{{ d }}）</strong> }</p>
            }
            <div class="ref-links">
              <strong>參考連結</strong>
              @for (l of item.details.sourceLinks; track l) {
                <div class="ref-link-row" data-link-row>
                  <input data-field="ref-label" placeholder="標籤" [(ngModel)]="l.label" [disabled]="!editable()" />
                  <input data-field="ref-url" type="url" placeholder="https://" [(ngModel)]="l.url" [disabled]="!editable()" />
                  @if (editable()) { <button type="button" data-remove-ref-link (click)="removeLink(item, l)">移除</button> }
                </div>
              } @empty { @if (!editable()) { <small>無</small> } }
              @if (editable()) { <button type="button" data-add-ref-link (click)="addLink(item)">新增參考連結</button> }
            </div>
            @if (editable()) { <button type="button" (click)="remove(item)">刪除</button> }
          </div>
        } @empty {
          <div class="empty" data-empty>{{ editable() ? "尚無項目，按下方「新增項目」開始。" : "尚無項目" }}</div>
        }
        @if (editable()) {
          <button type="button" [attr.data-add]="tab()" (click)="add(key())">新增項目</button>
          <button type="button" data-open-picker (click)="openPicker()">從工程師工作挑選</button>
        }
        @if (picking) {
          <div class="work-picker" data-work-picker>
            @if (pickError) { <p class="err" role="alert" data-picker-error>{{ pickError }}</p> }
            <label><input type="checkbox" data-important-only [checked]="onlyImportant" (change)="setOnlyImportant($any($event.target).checked)" /> 只看重要</label>
            @if (focus.length) { <button type="button" data-picker-back (click)="back()">← 上一層</button> }
            @for (w of focusList(); track w.workId) {
              <div [attr.data-pick-row]="w.workId">
                <span class="num">#{{ w.workId }}</span> {{ w.workContent }} <span class="num">{{ w.status }}・{{ w.percentage }}%</span>
                @if (!canBind(w.workId, bound())) { <em data-bound>已綁定</em> }
                @else { <button type="button" data-pick (click)="pick(w)">挑選</button> }
                @if (w.subItems?.length && w !== focus.at(-1)) { <button type="button" data-picker-children (click)="drill(w)">看子工作</button> }
              </div>
            }
            <button type="button" data-close-picker (click)="closePicker()">關閉</button>
          </div>
        }
      }
    </section>`,
})
export class FileView {
  private changes = inject(ChangeDetectorRef);
  private http = inject(HttpClient);
  readonly canBind = canBind;
  picking = false;
  pickError = "";
  engineerWorks: EngineerWork[] = [];
  onlyImportant = true;
  /** Drill path: the focused work and its direct children are listed instead of the whole tree. */
  focus: EngineerWork[] = [];
  file = input.required<string>();
  /** "projects" or a non-project section key. */
  tab = input.required<string>();
  key = computed(() => this.tab() as NonProjectSection);
  week = input("");
  /** All section files of the week (same object the editor mutates); a workId may be bound only once across them. */
  all = input<Record<string, Partial<SectionFile>>>({});
  bound = () => boundWorkIds(["s1", "s2", "s3"].map((f) => this.all()[f]));
  /** Mutated in place; the parent owns it and serialises it on save. */
  data = input.required<Partial<SectionFile>>();
  editable = input(false);
  baseline = input(new Map<number, number>());
  deltaText = deltaText;

  itemsOf = (section: string): SectionItem[] => (this.data().items ?? []).filter((i) => i.section === section);

  add(section: NonProjectSection) {
    (this.data().items ??= []).push({ id: crypto.randomUUID(), section, title: "", content: "", details: {} });
    this.changes.detectChanges();
  }
  focusList = (): EngineerWork[] => pickerList(this.engineerWorks, this.focus, this.onlyImportant);
  setOnlyImportant(value: boolean) {
    this.onlyImportant = value;
    this.focus = []; // focus holds copies trimmed under the old setting
  }
  drill(work: EngineerWork) {
    this.focus.push(work);
    this.changes.detectChanges();
  }
  back() {
    this.focus.pop();
    this.changes.detectChanges();
  }
  closePicker() {
    this.picking = false;
    this.changes.detectChanges();
  }
  async openPicker() {
    this.picking = true;
    this.pickError = "";
    this.focus = [];
    this.onlyImportant = true;
    this.engineerWorks = [];
    try {
      const data = await firstValueFrom(this.http.get<EngineerFile>(`/api/weeks/${this.week()}/engineer/${this.file()}`));
      this.engineerWorks = Object.values(data.results).flatMap((r) => r.items);
    } catch (e: any) {
      this.pickError = e?.status === 404 ? "本週尚無工程師工作彙整，請先到「工程師進度」上傳" : `載入失敗：${e?.error?.error ?? e?.status ?? "未知錯誤"}`;
    }
    this.changes.detectChanges();
  }
  pick(work: EngineerWork) {
    if (!canBind(work.workId, this.bound())) return;
    (this.data().items ??= []).push(itemFromWork(work, this.key()));
    this.changes.detectChanges();
  }
  addProject() {
    (this.data().items ??= []).push({ id: crypto.randomUUID(), section: "projects", title: "", content: "", details: {}, owner: "", participants: [this.file()], schedule: [], externalDependencies: [] });
    this.changes.detectChanges();
  }
  addLink(item: SectionItem) {
    (item.details.sourceLinks ??= []).push({ label: "", url: "" });
    this.changes.detectChanges();
  }
  removeLink(item: SectionItem, link: SourceLink) {
    item.details.sourceLinks = item.details.sourceLinks?.filter((l) => l !== link);
    this.changes.detectChanges();
  }
  remove(item: SectionItem) {
    const data = this.data();
    if (data.items) data.items = data.items.filter((i) => i !== item);
    this.changes.detectChanges();
  }
}
