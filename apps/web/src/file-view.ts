import { ChangeDetectorRef, Component, inject, input, output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ProjectSchedule } from "./project-schedule";
import { FILE_LABELS, SECTION_LABELS, type NonProjectSection, type SectionFile, type SectionItem } from "./report-types";

@Component({
  selector: "app-file-view",
  standalone: true,
  imports: [FormsModule, ProjectSchedule],
  template: `<section class="card" [attr.data-file]="file()">
      <h2>{{ FILE_LABELS[file()] }}@if (!editable()) { <small>（唯讀）</small> }</h2>
      <h3>專案</h3>
      @for (p of itemsOf("projects"); track p.id) {
        <app-project-schedule [week]="week()" [project]="p" [editable]="editable()" />
        @if (editable()) { <button type="button" (click)="remove(p)">刪除專案</button> }
      }
      @if (editable()) { <button type="button" data-add-project (click)="addProject()">新增專案</button> }
      @for (key of sectionKeys; track key) {
        <h3>{{ SECTION_LABELS[key] }}</h3>
        @for (item of itemsOf(key); track item.id) {
          <div class="item">
            <label>標題
              <input data-field="title" [(ngModel)]="item.title" [disabled]="!editable()" /></label>
            @if (key === "personnel") {
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
            @if (editable()) { <button type="button" (click)="remove(item)">刪除</button> }
          </div>
        }
        @if (editable()) { <button type="button" [attr.data-add]="key" (click)="add(key)">新增項目</button> }
      }
      @if (editable()) { <p><button type="button" data-save (click)="save.emit()">儲存</button></p> }
    </section>`,
})
export class FileView {
  private changes = inject(ChangeDetectorRef);
  readonly SECTION_LABELS = SECTION_LABELS;
  readonly FILE_LABELS = FILE_LABELS;
  readonly sectionKeys = Object.keys(SECTION_LABELS) as NonProjectSection[];
  file = input.required<string>();
  week = input("");
  /** Mutated in place; the parent owns it and serialises it on save. */
  data = input.required<Partial<SectionFile>>();
  editable = input(false);
  save = output<void>();

  itemsOf = (section: string): SectionItem[] => (this.data().items ?? []).filter((i) => i.section === section);

  add(section: NonProjectSection) {
    (this.data().items ??= []).push({ id: crypto.randomUUID(), section, title: "", content: "", details: {} });
    this.changes.detectChanges();
  }
  addProject() {
    (this.data().items ??= []).push({ id: crypto.randomUUID(), section: "projects", title: "", content: "", details: {}, owner: "", participants: [this.file()], schedule: [], externalDependencies: [] });
    this.changes.detectChanges();
  }
  remove(item: SectionItem) {
    const data = this.data();
    if (data.items) data.items = data.items.filter((i) => i !== item);
    this.changes.detectChanges();
  }
}
