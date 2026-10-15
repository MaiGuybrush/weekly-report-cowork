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
import {
  CalendarDay,
  DatePickerMode,
  applyDateSelection,
  clearSelection,
  formatDateDisplay,
  generateCalendarMonth,
  getPreviewRange,
  getTodayIso,
  isDateInHoverRange,
  isDateInRange,
  nextMonth,
  parseDateIso,
  prevMonth,
} from "./date-range-picker-model";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

@Component({
  selector: "app-date-range-picker",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="drp-container" [class.drp-disabled]="disabled()">
      <!-- Trigger Box -->
      <div
        class="drp-trigger"
        role="button"
        tabindex="0"
        [attr.aria-expanded]="isOpen()"
        [attr.aria-label]="ariaLabel()"
        [attr.data-state]="isOpen() ? 'open' : 'closed'"
        (click)="toggleDropdown()"
        (keydown.enter)="toggleDropdown()"
        (keydown.space)="toggleDropdown(); $event.preventDefault()">
        <span class="drp-icon" aria-hidden="true">📅</span>
        <span class="drp-display-text" [class.drp-placeholder]="!hasValue()">
          {{ displayText() || placeholderText() }}
        </span>

        @if (!disabled()) {
          <div class="drp-actions" (click)="$event.stopPropagation()">
            <button
              type="button"
              class="drp-quick-today-btn"
              title="設為今天"
              aria-label="設為今天"
              (click)="onSetToday($event)">
              今天
            </button>
            @if (hasValue()) {
              <button
                type="button"
                class="drp-clear-btn"
                title="清除日期"
                aria-label="清除日期"
                (click)="onClear($event)">
                ✕
              </button>
            }
          </div>
        }
      </div>

      <!-- Calendar Popup Dropdown -->
      @if (isOpen()) {
        <div class="drp-popup" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
          <div class="drp-header">
            <button
              type="button"
              class="drp-nav-btn drp-prev-btn"
              title="上個月"
              aria-label="上個月"
              (click)="onPrevMonth()">
              ‹
            </button>
            <span class="drp-month-title">{{ currentMonthTitle() }}</span>
            <button
              type="button"
              class="drp-nav-btn drp-next-btn"
              title="下個月"
              aria-label="下個月"
              (click)="onNextMonth()">
              ›
            </button>
            <button
              type="button"
              class="drp-today-btn"
              title="前往今天所在月份"
              (click)="onGoToday()">
              今天
            </button>
          </div>

          <div class="drp-weekdays">
            @for (w of weekdays; track w) {
              <span class="drp-weekday">{{ w }}</span>
            }
          </div>

          <div class="drp-grid" (mouseleave)="onGridMouseLeave()">
            @for (week of calendar().weeks; track $index) {
              @for (day of week; track day.dateString) {
                <button
                  type="button"
                  class="drp-day"
                  [attr.data-date]="day.dateString"
                  [class.drp-other-month]="!day.isCurrentMonth"
                  [class.drp-today]="day.isToday"
                  [class.drp-selected-start]="isStart(day.dateString)"
                  [class.drp-selected-end]="isEnd(day.dateString)"
                  [class.drp-in-range]="isInSelectedRange(day.dateString)"
                  [class.drp-in-hover]="isInHoverPreview(day.dateString)"
                  (click)="onDayClick(day)"
                  (mouseenter)="onDayMouseEnter(day)">
                  {{ day.day }}
                </button>
              }
            }
          </div>

          <div class="drp-footer">
            <span class="drp-hint">
              @if (mode() === 'single') {
                點選日期完成選取
              } @else if (isSelectingRange()) {
                已選起日，請點選迄日
              } @else {
                依序點選起日與迄日
              }
            </span>
          </div>
        </div>
      }
    </div>
  `,
})
export class DateRangePicker {
  private elementRef = inject(ElementRef);

  mode = input<DatePickerMode>("range");
  startDate = model<string | null>(null);
  endDate = model<string | null>(null);
  value = model<string | null>(null);
  disabled = input<boolean>(false);
  placeholder = input<string>("");
  ariaLabel = input<string>("選擇日期");

  readonly weekdays = WEEKDAYS;

  isOpen = signal<boolean>(false);
  viewYear = signal<number>(new Date().getFullYear());
  viewMonth = signal<number>(new Date().getMonth() + 1);

  isSelectingRange = signal<boolean>(false);
  pendingStart = signal<string | null>(null);
  hoverDate = signal<string | null>(null);

  effectiveStart = computed<string | null>(() => {
    if (this.isSelectingRange()) {
      return this.pendingStart();
    }
    if (this.mode() === "single") {
      return this.value() ?? this.startDate();
    }
    return this.startDate();
  });

  effectiveEnd = computed<string | null>(() => {
    if (this.isSelectingRange() || this.mode() === "single") {
      return null;
    }
    return this.endDate();
  });

  hasValue = computed<boolean>(() => {
    if (this.mode() === "single") {
      return !!(this.value() || this.startDate());
    }
    return !!(this.startDate() || this.endDate());
  });

  placeholderText = computed<string>(() => {
    if (this.placeholder()) return this.placeholder();
    return this.mode() === "single" ? "選擇日期" : "選擇起訖區間";
  });

  displayText = computed<string>(() => {
    return formatDateDisplay(this.effectiveStart(), this.effectiveEnd(), this.mode());
  });

  calendar = computed(() => {
    return generateCalendarMonth(this.viewYear(), this.viewMonth());
  });

  currentMonthTitle = computed<string>(() => {
    return `${this.viewYear()} 年 ${this.viewMonth()} 月`;
  });

  private resetTransientState() {
    this.isSelectingRange.set(false);
    this.pendingStart.set(null);
    this.hoverDate.set(null);
  }

  toggleDropdown() {
    if (this.disabled()) return;
    if (this.isOpen()) {
      this.closeDropdown();
    } else {
      this.openDropdown();
    }
  }

  openDropdown() {
    if (this.disabled()) return;
    const refDate = this.effectiveStart() || getTodayIso();
    const parsed = parseDateIso(refDate);
    if (parsed) {
      this.viewYear.set(parsed.year);
      this.viewMonth.set(parsed.month);
    }
    this.resetTransientState();
    this.isOpen.set(true);
  }

  closeDropdown() {
    this.isOpen.set(false);
    this.resetTransientState();
  }

  onPrevMonth() {
    const prev = prevMonth(this.viewYear(), this.viewMonth());
    this.viewYear.set(prev.year);
    this.viewMonth.set(prev.month);
  }

  onNextMonth() {
    const next = nextMonth(this.viewYear(), this.viewMonth());
    this.viewYear.set(next.year);
    this.viewMonth.set(next.month);
  }

  onGoToday() {
    const today = parseDateIso(getTodayIso())!;
    this.viewYear.set(today.year);
    this.viewMonth.set(today.month);
  }

  onSetToday(event: MouseEvent) {
    event.stopPropagation();
    const today = getTodayIso();
    if (this.mode() === "single") {
      this.value.set(today);
      this.startDate.set(today);
      this.endDate.set(null);
    } else {
      this.startDate.set(today);
      this.endDate.set(today);
    }
    this.closeDropdown();
  }

  onDayClick(day: CalendarDay) {
    if (this.disabled()) return;

    const currentSelection = {
      startDate: this.pendingStart() || this.effectiveStart(),
      endDate: this.effectiveEnd(),
      isSelectingRange: this.isSelectingRange(),
    };

    const result = applyDateSelection(currentSelection, day.dateString, this.mode());

    if (result.completed) {
      if (this.mode() === "single") {
        this.value.set(result.startDate);
        this.startDate.set(result.startDate);
        this.endDate.set(null);
      } else {
        this.startDate.set(result.startDate);
        this.endDate.set(result.endDate);
      }
      this.closeDropdown();
    } else {
      this.isSelectingRange.set(true);
      this.pendingStart.set(result.startDate);
      this.hoverDate.set(result.startDate);
    }
  }

  onDayMouseEnter(day: CalendarDay) {
    if (this.isSelectingRange()) {
      this.hoverDate.set(day.dateString);
    }
  }

  onGridMouseLeave() {
    this.hoverDate.set(null);
  }

  onClear(event: MouseEvent) {
    event.stopPropagation();
    const res = clearSelection();
    this.startDate.set(res.startDate);
    this.endDate.set(res.endDate);
    this.value.set(null);
    this.closeDropdown();
  }

  isStart(dateString: string): boolean {
    if (this.isSelectingRange()) {
      const { previewStart } = getPreviewRange(this.pendingStart(), this.hoverDate());
      return dateString === previewStart;
    }
    return dateString === this.effectiveStart();
  }

  isEnd(dateString: string): boolean {
    if (this.isSelectingRange()) {
      const { previewEnd } = getPreviewRange(this.pendingStart(), this.hoverDate());
      return dateString === previewEnd;
    }
    if (this.mode() === "single") {
      return dateString === this.effectiveStart();
    }
    return dateString === this.effectiveEnd();
  }

  isInSelectedRange(dateString: string): boolean {
    if (this.isSelectingRange()) return false;
    return isDateInRange(dateString, this.effectiveStart(), this.effectiveEnd());
  }

  isInHoverPreview(dateString: string): boolean {
    if (!this.isSelectingRange()) return false;
    return isDateInHoverRange(dateString, this.pendingStart(), this.hoverDate(), true);
  }

  @HostListener("document:pointerdown", ["$event"])
  onDocumentPointerDown(event: PointerEvent) {
    if (!this.isOpen()) return;
    const target = event.target as Node | null;
    if (target && !this.elementRef.nativeElement.contains(target)) {
      this.closeDropdown();
    }
  }

  @HostListener("keydown.escape")
  onEscapeKey() {
    if (this.isOpen()) {
      this.closeDropdown();
    }
  }
}
