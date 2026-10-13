import { ChangeDetectorRef, Component, inject, input } from "@angular/core";
import { FormsModule } from "@angular/forms";
import type { CrossFile } from "./report-types";

@Component({
  selector: "app-cross-editor",
  standalone: true,
  imports: [FormsModule],
  template: `<section data-file="cross">
      @if (tab() === "summary") {
        <label>本週管理摘要
          <textarea data-field="managementSummary" rows="4" [(ngModel)]="cross().managementSummary" [disabled]="!editable()"></textarea></label>
      } @else {
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
        } @empty {
          <div class="empty" data-empty>{{ editable() ? "尚無待決策事項，按下方「新增待決策事項」開始。" : "尚無待決策事項" }}</div>
        }
        @if (editable()) { <button type="button" data-add-decision (click)="addDecision()">新增待決策事項</button> }
      }
    </section>`,
})
export class CrossEditor {
  private changes = inject(ChangeDetectorRef);
  /** Mutated in place; the parent owns it and serialises it on save. */
  cross = input.required<CrossFile>();
  /** "summary" or "decisions". */
  tab = input.required<string>();
  editable = input(false);

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
