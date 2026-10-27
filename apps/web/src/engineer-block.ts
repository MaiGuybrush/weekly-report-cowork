import { Component, input, output } from "@angular/core";
import type { EngineerFile } from "./engineer-progress";
import { WorkList, type WorkAnnotation } from "./engineer-work";

/** 一位工程師：標題（工時、休假）加上工作樹。 */
@Component({
  selector: "app-engineer-block",
  standalone: true,
  imports: [WorkList],
  host: { style: "display: contents" },
  template: `<h3 [attr.data-engineer]="name()" [id]="'e-' + name()">{{ name() }} <small class="num">工時 {{ result().totalWorkHours ?? 0 }}H・休假 {{ result().totalOffHours ?? 0 }}H</small></h3>
    <ul app-work-list class="work-tree" [items]="result().items" [editable]="editable()" [onlyImportant]="onlyImportant()" (annotated)="annotated.emit($event)"></ul>`,
})
export class EngineerBlock {
  name = input.required<string>();
  result = input.required<EngineerFile["results"][string]>();
  editable = input(false);
  onlyImportant = input(false);
  annotated = output<WorkAnnotation>();
}
