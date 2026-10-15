import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  input,
  model,
  signal,
} from "@angular/core";
import { PredecessorOption, selectAllIds, summarizeSelection, toggleId } from "./predecessor-select-model";

@Component({
  selector: "app-predecessor-select",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pre-container" [class.pre-disabled]="disabled()">
      <div
        class="pre-trigger"
        role="button"
        [attr.tabindex]="disabled() ? -1 : 0"
        [attr.aria-expanded]="isOpen()"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-disabled]="disabled()"
        [attr.data-state]="isOpen() ? 'open' : 'closed'"
        (click)="toggleDropdown()"
        (keydown.enter)="toggleDropdown()"
        (keydown.space)="toggleDropdown(); $event.preventDefault()">
        @if (summary().names.length) {
          <span class="pre-pills">
            @for (n of summary().names; track $index) { <span class="pre-pill">{{ n }}</span> }
            @if (summary().extra) { <span class="pre-pill pre-more">+{{ summary().extra }}</span> }
          </span>
        } @else {
          <span class="pre-placeholder">{{ placeholder() }}</span>
        }
        <span class="pre-caret" aria-hidden="true">▾</span>
      </div>

      @if (isOpen()) {
        <div class="pre-popup" role="dialog" (click)="$event.stopPropagation()">
          <div class="pre-tools">
            <button type="button" class="pre-all-btn" (click)="onSelectAll()">全選</button>
            <button type="button" class="pre-clear-btn" (click)="onClear()">全部清除</button>
          </div>
          @for (o of options(); track o.id) {
            <label class="pre-option">
              <input type="checkbox" [attr.data-option]="o.id" [checked]="isChecked(o.id)" (change)="onToggle(o.id)" />
              <span>{{ o.name || '（未命名）' }}</span>
            </label>
          } @empty {
            <p class="pre-empty">沒有可選的前置項目</p>
          }
        </div>
      }
    </div>
  `,
})
export class PredecessorSelect {
  private elementRef = inject(ElementRef);

  options = input<PredecessorOption[]>([]);
  selected = model<string[]>([]);
  disabled = input<boolean>(false);
  placeholder = input<string>("選擇前置項目");
  ariaLabel = input<string>("前置項目");

  isOpen = signal<boolean>(false);

  summary = computed(() => summarizeSelection(this.selected(), this.options()));

  isChecked(id: string): boolean {
    return (this.selected() ?? []).includes(id);
  }

  toggleDropdown() {
    if (this.disabled()) return;
    this.isOpen.update((v) => !v);
  }

  onToggle(id: string) {
    if (this.disabled()) return;
    this.selected.set(toggleId(this.selected(), id));
  }

  onSelectAll() {
    if (this.disabled()) return;
    this.selected.set(selectAllIds(this.options()));
  }

  onClear() {
    if (this.disabled()) return;
    this.selected.set([]);
  }

  @HostListener("document:pointerdown", ["$event"])
  onDocumentPointerDown(event: PointerEvent) {
    if (!this.isOpen()) return;
    const target = event.target as Node | null;
    if (target && !this.elementRef.nativeElement.contains(target)) this.isOpen.set(false);
  }

  @HostListener("keydown.escape")
  onEscapeKey() {
    this.isOpen.set(false);
  }
}
