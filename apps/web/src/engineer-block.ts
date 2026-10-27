import { Component, computed, input, output } from "@angular/core";
import type { EngineerFile } from "./engineer-progress";
import { displayName, filterImportant } from "./engineer-model";
import { WorkList, type BulkCollapse, type WorkAnnotation } from "./engineer-work";

/** 一位工程師：標題（工時、休假）加上工作樹。 */
@Component({
  selector: "app-engineer-block",
  standalone: true,
  imports: [WorkList],
  host: { style: "display: contents" },
  template: `<h3 [attr.data-engineer]="name()" [id]="'e-' + name()">{{ title() }} <small class="num">工時 {{ result().totalWorkHours ?? 0 }}H・休假 {{ result().totalOffHours ?? 0 }}H</small></h3>
    @if (onlyImportant() && !items().length) {
      <p class="empty" data-no-important>此工程師本週沒有重要工作</p>
    } @else {
      <ul app-work-list class="work-tree" [items]="items()" [editable]="editable()" [bulk]="bulk()" (annotated)="annotated.emit($event)"></ul>
    }`,
})
export class EngineerBlock {
  name = input.required<string>();
  result = input.required<EngineerFile["results"][string]>();
  editable = input(false);
  onlyImportant = input(false);
  bulk = input<BulkCollapse | null>(null);
  items = computed(() => (this.onlyImportant() ? filterImportant(this.result().items) : this.result().items));
  title = computed(() => displayName(this.name(), this.result().items));
  annotated = output<WorkAnnotation>();
}
