import { ChangeDetectorRef, Component, inject, input, output } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { CrossFile } from "./report-types";

@Component({
  selector: "app-cross-editor",
  standalone: true,
  imports: [FormsModule],
  template: `<section class="card" data-file="cross">
      <h2>跨課@if (!editable()) { <small>（唯讀）</small> }</h2>
      <label>本週管理摘要
        <textarea data-field="managementSummary" rows="4" [(ngModel)]="cross().managementSummary" [disabled]="!editable()"></textarea></label>
      <h3>待決策事項</h3>
      @for (d of cross().pendingDecisions; track d.id) {
        <div class="item">
          <label>說明
            <input data-field="decision-description" [(ngModel)]="d.description" [disabled]="!editable()" /></label>
          <label>結果
            <input [(ngModel)]="d.result" [disabled]="!editable()" /></label>
          <label>新到期日
            <input type="date" [(ngModel)]="d.newDueDate" [disabled]="!editable()" /></label>
          @if (editable()) { <button type="button" (click)="removeDecision(d)">刪除</button> }
        </div>
      }
      @if (editable()) {
        <button type="button" data-add-decision (click)="addDecision()">新增待決策事項</button>
        <p><button type="button" data-save (click)="save.emit()">儲存</button></p>
      }
    </section>`,
})
export class CrossEditor {
  private changes = inject(ChangeDetectorRef);
  /** Mutated in place; the parent owns it and serialises it on save. */
  cross = input.required<CrossFile>();
  editable = input(false);
  save = output<void>();

  addDecision() {
    this.cross().pendingDecisions.push({ id: crypto.randomUUID(), description: "" });
    this.changes.detectChanges();
  }
  removeDecision(d: CrossFile["pendingDecisions"][number]) {
    const cross = this.cross();
    cross.pendingDecisions = cross.pendingDecisions.filter((x) => x !== d);
    this.changes.detectChanges();
  }
}
