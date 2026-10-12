import { Component, computed, input, output, signal } from "@angular/core";
import {
  GanttEntry,
  ganttDisplayEntries,
  ganttMarks,
  ganttPosition,
  ganttTooltip,
  ganttRange,
  ganttTicks,
  ganttWidth,
  hasChildTasks,
  stateLabel,
  varianceBadgeClass,
  varianceText,
} from "./gantt-model";

@Component({
  selector: "app-gantt",
  standalone: true,
  template: `
    <div class="gantt">
      <div class="gantt-header">
        <div class="gantt-header-title">
          <h4><strong>專案甘特圖</strong> · 處會摘要</h4>
          <span class="gantt-meeting-date">報告日：{{ meetingDate() }}</span>
        </div>
        <div class="gantt-toolbar">
          <button
            type="button"
            class="btn-gantt-toggle btn-gantt-toggle-tasks"
            (click)="expandTasks.set(!expandTasks())"
            [attr.aria-expanded]="expandTasks()">
            {{ expandTasks() ? '收合關鍵任務' : '展開關鍵任務' }}
          </button>
          @if (cancelledCount()) {
            <button
              type="button"
              class="btn-gantt-toggle btn-gantt-toggle-cancelled"
              (click)="showCancelled.set(!showCancelled())"
              [attr.aria-expanded]="showCancelled()">
              {{ showCancelled() ? '隱藏已取消項目' : '顯示已取消項目 (' + cancelledCount() + ')' }}
            </button>
          }
        </div>
      </div>

      <div class="gantt-legend">
        <span class="legend-item"><i class="legend-bar plan-bar"></i> 計畫</span>
        <span class="legend-item"><i class="legend-bar actual-bar"></i> 實際</span>
        <span class="legend-item"><i class="legend-diamond pending-diamond"></i> 計畫節點</span>
        <span class="legend-item"><i class="legend-diamond achieved-diamond"></i> 實際節點</span>
      </div>

      <div class="gantt-timeline-header">
        <div class="gantt-meta-spacer">項目名稱與層級</div>
        <div class="gantt-timeline-scale">
          @for (tick of ticks(); track tick.percent) {
            <span class="gantt-tick" [style.left.%]="tick.percent">{{ tick.label }}</span>
          }
        </div>
        <div class="gantt-stats-spacer">狀態與總偏差</div>
      </div>

      <div class="gantt-body">
        @for (entry of rows(); track entry.id) {
          <div
            class="gantt-row"
            [class.gantt-row-task]="entry.kind === 'task'"
            [class.gantt-row-milestone]="entry.kind === 'milestone'"
            [class.gantt-row-phase]="entry.kind === 'phase'"
            [class.gantt-row-cancelled]="entry.state === 'cancelled'"
            (click)="entrySelected.emit(entry.id)">
            <div class="gantt-meta">
              @if (entry.kind === 'phase' && hasChildren(entry.id)) {
                <button
                  type="button"
                  class="btn-phase-expand"
                  (click)="$event.stopPropagation(); togglePhase(entry.id)"
                  [title]="isExpanded(entry.id) ? '收合此階段任務' : '展開此階段任務'">
                  {{ isExpanded(entry.id) ? '▼' : '▶' }}
                </button>
              } @else if (entry.kind === 'task') {
                <span class="gantt-task-indent">↳</span>
              }
              <span class="gantt-kind-badge" [attr.data-kind]="entry.kind">
                {{ entry.kind === 'phase' ? '階段' : entry.kind === 'task' ? '任務' : '里程碑' }}
              </span>
              <span class="gantt-name" [title]="entry.name">{{ entry.name }}</span>
              @if (entry.kind === 'task' && entry.owner) {
                <span class="gantt-owner-chip" [title]="'負責人/單位: ' + entry.owner">👤 {{ entry.owner }}</span>
              }
              @if (entry.warnings?.length) {
                <small class="gantt-warn-icon" [title]="entry.warnings![0].message">⚠️</small>
              }
              @if (entry.externalNotices?.length) {
                <small class="gantt-ext-icon" [title]="entry.externalNotices![0].message">🌐</small>
              }
              @if (entry.kind === 'task' && entry.evidenceLinks?.length) {
                <span class="gantt-evidence-chip" [title]="'已連結 ' + entry.evidenceLinks!.length + ' 筆來源連結'">📎 {{ entry.evidenceLinks!.length }}</span>
              }
            </div>

            <div class="gantt-track">
              @if (meetingPosition(); as mPos) {
                <div class="gantt-today-line" [style.left.%]="mPos" title="報告日基準線"></div>
              }

              @if (marks(entry); as m) {
                @if (m.planDiamond) {
                  <i
                    class="milestone-target-marker"
                    [style.left.%]="position(m.planDiamond)"
                    [title]="tooltip(entry)"></i>
                }
                @if (m.actualDiamond) {
                  <i
                    class="milestone-marker achieved-marker"
                    [attr.data-state]="entry.state"
                    [style.left.%]="position(m.actualDiamond)"
                    [title]="tooltip(entry)"></i>
                }
                @if (m.planBar) {
                  <i
                    class="plan plan-bar"
                    [style.left.%]="position(m.planBar.start)"
                    [style.width.%]="width(m.planBar.start, m.planBar.end)"
                    [title]="tooltip(entry)"></i>
                }
                @if (m.actualBar) {
                  <i
                    class="actual actual-bar"
                    [style.left.%]="position(m.actualBar.start)"
                    [style.width.%]="width(m.actualBar.start, m.actualBar.end)"
                    [title]="tooltip(entry)"></i>
                }
              }
            </div>

            <div class="gantt-stats">
              <span class="gantt-state-pill" [attr.data-state]="entry.state">{{ stateLabel(entry.state) }}</span>
              <span [class]="'gantt-variance-badge ' + varianceBadgeClass(entry)">{{ varianceText(entry) }}</span>
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class Gantt {
  entries = input.required<GanttEntry[]>();
  meetingDate = input<string>();
  /** Emits the id of the clicked entry. */
  entrySelected = output<string>();

  expandTasks = signal(false);
  showCancelled = signal(false);
  private expandedPhases = signal<ReadonlySet<string>>(new Set());

  private range = computed(() => ganttRange(this.entries()));
  ticks = computed(() => ganttTicks(this.range()));
  cancelledCount = computed(() => this.entries().filter((e) => e.state === "cancelled").length);
  rows = computed(() =>
    ganttDisplayEntries(this.entries(), {
      expandTasks: this.expandTasks(),
      showCancelled: this.showCancelled(),
      expandedPhases: this.expandedPhases(),
    }),
  );
  meetingPosition = computed(() => (this.meetingDate() ? ganttPosition(this.range(), this.meetingDate()) : null));

  position = (date: string | null | undefined) => ganttPosition(this.range(), date);
  width = (start: string | null | undefined, end: string | null | undefined) => ganttWidth(this.range(), start, end);
  hasChildren = (phaseId: string) => hasChildTasks(this.entries(), phaseId, this.showCancelled());
  isExpanded = (phaseId: string) => this.expandTasks() || this.expandedPhases().has(phaseId);
  togglePhase(phaseId: string) {
    const next = new Set(this.expandedPhases());
    if (!next.delete(phaseId)) next.add(phaseId);
    this.expandedPhases.set(next);
  }

  marks = ganttMarks;
  tooltip = ganttTooltip;
  stateLabel = stateLabel;
  varianceText = varianceText;
  varianceBadgeClass = varianceBadgeClass;
}
