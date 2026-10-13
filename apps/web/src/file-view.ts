import { ChangeDetectorRef, Component, computed, inject, input } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { ProjectSchedule } from "./project-schedule";
import { type NonProjectSection, type SourceLink, type SectionFile, type SectionItem } from "./report-types";

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
          <app-project-schedule [week]="week()" [project]="p" [editable]="editable()" />
          @if (editable()) { <button type="button" (click)="remove(p)">刪除專案</button> }
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
            <div class="ref-links">
              <strong>參考連結</strong>
              @for (l of item.details.sourceLinks; track l) {
                <div class="ref-link-row" data-ref-link>
                  <input data-field="ref-label" placeholder="標籤" [(ngModel)]="l.label" [disabled]="!editable()" />
                  <input data-field="ref-url" type="url" placeholder="https://" [(ngModel)]="l.url" [disabled]="!editable()" />
                  @if (editable()) { <button type="button" data-remove-ref-link (click)="removeLink(item, l)">移除</button> }
                </div>
              } @empty { @if (!editable()) { <small>無</small> } }
              @if (editable()) { <button type="button" data-add-ref-link (click)="addLink(item)">新增參考連結</button> }
            </div>
            @if (editable()) { <button type="button" (click)="remove(item)">刪除</button> }
          </div>
        }
        @if (editable()) { <button type="button" [attr.data-add]="tab()" (click)="add(key())">新增項目</button> }
      }
    </section>`,
})
export class FileView {
  private changes = inject(ChangeDetectorRef);
  file = input.required<string>();
  /** "projects" or a non-project section key. */
  tab = input.required<string>();
  key = computed(() => this.tab() as NonProjectSection);
  week = input("");
  /** Mutated in place; the parent owns it and serialises it on save. */
  data = input.required<Partial<SectionFile>>();
  editable = input(false);

  itemsOf = (section: string): SectionItem[] => (this.data().items ?? []).filter((i) => i.section === section);

  add(section: NonProjectSection) {
    (this.data().items ??= []).push({ id: crypto.randomUUID(), section, title: "", content: "", details: {} });
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
