import { Component, ElementRef, effect, forwardRef, inject, input, output, signal, viewChild } from "@angular/core";
import { WORK_URL_TEMPLATE } from "./config";
import type { EngineerWork } from "./engineer-progress";

/** 耗時達此值（小時）的工作加註標示。 */
export const LONG_HOURS = 10;

export type WorkAnnotation = { work: EngineerWork; isImportant: boolean; managerComment: string };

/** 工具列「全部展開／收合」：每次點擊換一個新物件，各列據此重設自己的收合狀態。 */
export type BulkCollapse = { collapsed: boolean };

@Component({
  selector: "li[app-work-row]",
  standalone: true,
  imports: [forwardRef(() => WorkList)],
  host: { "[attr.data-work]": "work().workId", "[id]": "'w' + work().workId", "[attr.data-absent]": "work().absent ? '' : null" },
  template: `@if (work().subItems?.length) {
      <button type="button" data-collapse class="icon-btn" [attr.aria-expanded]="!collapsed()" [attr.aria-label]="(collapsed() ? '展開 #' : '收合 #') + work().workId" (click)="collapsed.set(!collapsed())">{{ collapsed() ? "▸" : "▾" }}</button>
    }
    <a data-work-link class="num" [href]="href()" target="_blank" rel="noopener">#{{ work().workId }}</a> {{ work().workContent }}
    <span class="num">{{ work().status }}・{{ work().percentage }}%・{{ work().deltaTime }}H</span>
    @if (work().deltaTime >= LONG_HOURS) { <em data-long>耗時 ≥{{ LONG_HOURS }}H</em> }
    @if (work().rmsFlag) { <em data-rms>RMS</em> }
    @if (work().absent) { <em data-absent-note>本週彙整未出現此工作（可能本週無進度）</em> }
    @if (editable()) {
      <button type="button" data-star [attr.aria-pressed]="!!work().isImportant" [attr.aria-label]="'標記 #' + work().workId + ' 為重要'" (click)="annotated.emit({ work: work(), isImportant: !work().isImportant, managerComment: work().managerComment ?? '' })">{{ work().isImportant ? "★" : "☆" }}</button>
      <button type="button" data-comment-toggle [class.has-comment]="!!work().managerComment" [attr.aria-label]="'評語 #' + work().workId" (click)="open()">💬</button>
    } @else if (work().isImportant) {
      <em data-important>★ 重要</em>
    }
    @if (work().lastComment) { <small data-last-comment>上週：{{ work().lastComment }}</small> }
    @if (editing()) {
      <input #box type="text" data-comment maxlength="2000" placeholder="comment" [value]="work().managerComment ?? ''" (blur)="save(box.value)" (keydown.escape)="cancel()" />
    } @else if (work().managerComment) {
      @if (editable()) {
        <button type="button" data-comment-quote class="quote" (click)="open()">{{ work().managerComment }}</button>
      } @else {
        <span data-comment-quote class="quote">{{ work().managerComment }}</span>
      }
    }
    @if (work().subItems?.length && !collapsed()) {
      <ul app-work-list [items]="work().subItems!" [editable]="editable()" [bulk]="bulk()" (annotated)="annotated.emit($event)"></ul>
    }`,
})
export class WorkRow {
  readonly LONG_HOURS = LONG_HOURS;
  work = input.required<EngineerWork>();
  editable = input(false);
  bulk = input<BulkCollapse | null>(null);
  annotated = output<WorkAnnotation>();
  collapsed = signal(false);
  editing = signal(false);
  private cancelled = false;
  private box = viewChild<ElementRef<HTMLInputElement>>("box");
  private template = inject(WORK_URL_TEMPLATE);
  href = () => this.template.replace("{id}", String(this.work().workId));

  constructor() {
    effect(() => this.box()?.nativeElement.focus());
    effect(() => {
      const b = this.bulk();
      if (b) this.collapsed.set(b.collapsed);
    });
  }
  open() {
    this.cancelled = false;
    this.editing.set(true);
  }
  cancel() {
    this.cancelled = true;
    this.editing.set(false);
  }
  save(value: string) {
    if (this.cancelled) return;
    this.editing.set(false);
    if (value !== (this.work().managerComment ?? "")) this.annotated.emit({ work: this.work(), isImportant: !!this.work().isImportant, managerComment: value });
  }
}

@Component({
  selector: "ul[app-work-list]",
  standalone: true,
  imports: [WorkRow],
  template: `@for (w of items(); track w.workId) {
    <li app-work-row [work]="w" [editable]="editable()" [bulk]="bulk()" (annotated)="annotated.emit($event)"></li>
  }`,
})
export class WorkList {
  items = input.required<EngineerWork[]>();
  editable = input(false);
  bulk = input<BulkCollapse | null>(null);
  annotated = output<WorkAnnotation>();
}
