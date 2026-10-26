import { Component, computed, input, model, output, signal } from "@angular/core";
import {
  GanttEntry,
  ganttAnchor,
  ganttDisplayEntries,
  ganttLinks,
  ganttMarks,
  ganttPosition,
  ganttTooltip,
  forecastEnds,
  criticalChain,
  ganttRange,
  ganttTicks,
  ganttWidth,
  hasChildTasks,
  isPhaseOpen,
  localToday,
  stateLabel,
  varianceBadgeClass,
  varianceText,
} from "./gantt-model";
import { expectedProgress, progressStatus, progressText } from "./project-progress";

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
          <button
            type="button"
            class="btn-gantt-toggle btn-gantt-toggle-links"
            (click)="showAllLinks.set(!showAllLinks())"
            [attr.aria-pressed]="showAllLinks()">
            {{ showAllLinks() ? '隱藏相依線' : '顯示全部相依線' }}
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
        <span class="legend-item"><i class="legend-bar actual-bar late"></i> 實際（逾期）</span>
        <span class="legend-item"><i class="legend-bar forecast-bar"></i> 預估完工</span>
        <span class="legend-item"><i class="legend-critical"></i> 關鍵鏈（延誤即拖延專案）</span>
        <span class="legend-item"><i class="legend-expected" data-status="normal"></i> 計畫應有進度：實際差距 10 點內正常</span>
        <span class="legend-item"><i class="legend-expected" data-status="behind"></i> 落後（低 10 點以上）</span>
        <span class="legend-item"><i class="legend-expected" data-status="ahead"></i> 領先（高 10 點以上）</span>
        <span class="legend-item"><i class="legend-diamond pending-diamond"></i> 計畫節點</span>
        <span class="legend-item"><i class="legend-diamond achieved-diamond"></i> 實際節點</span>
      </div>

      <div class="gantt-timeline-header">
        <div class="gantt-meta-spacer">項目名稱與層級</div>
        <div class="gantt-timeline-scale">
          @for (tick of ticks(); track tick.percent) {
            <span class="gantt-tick" [style.left.%]="tick.percent">{{ tick.label }}</span>
          }
          <b class="gantt-today-label" [style.left.%]="todayPosition()">今天 {{ todayLabel() }}</b>
        </div>
        <div class="gantt-stats-spacer">狀態與總偏差</div>
      </div>

      <div class="gantt-body">
        @if (drawnLinks().length) {
          <div class="gantt-links" aria-hidden="true">
            <svg [attr.viewBox]="'0 0 100 ' + rows().length" preserveAspectRatio="none">
              @for (l of drawnLinks(); track l.from + l.to) {
                <path class="gantt-link" [class.gantt-link-active]="l.active" [attr.data-link]="l.from + '>' + l.to" [attr.d]="l.d" />
              }
            </svg>
          </div>
        }
        @for (entry of rows(); track entry.id) {
          <div
            class="gantt-row"
            [class.gantt-row-task]="entry.kind === 'task'"
            [class.gantt-row-milestone]="entry.kind === 'milestone'"
            [class.gantt-row-phase]="entry.kind === 'phase'"
            [class.gantt-row-cancelled]="entry.state === 'cancelled'"
            [class.gantt-row-critical]="critical().has(entry.id)"
            [attr.data-critical]="critical().has(entry.id) ? '' : null"
            [class.gantt-row-selected]="entry.id === selectedId()"
            [class.gantt-row-related]="related().has(entry.id)"
            [attr.data-gantt-id]="entry.id"
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
              @if (entry.kind === 'task' && entry.workId != null) {
                <span class="gantt-evidence-chip" [title]="'來源 #' + entry.workId">已綁定</span>
              }
            </div>

            <div class="gantt-track">
              <div class="gantt-today-line" [style.left.%]="todayPosition()" title="今日基準線"></div>

              @if (marks(entry, today()); as m) {
                @if (m.planDiamond) {
                  <i
                    class="milestone-target-marker"
                    [style.left.%]="position(m.planDiamond)"
                    [title]="tooltip(entry)"></i>
                }
                @if (m.actualDiamond) {
                  <i
                    class="milestone-marker achieved-marker"
                    [class.late]="m.actualClass.includes('late')"
                    [attr.data-state]="entry.state"
                    [style.left.%]="position(m.actualDiamond)"
                    [title]="tooltip(entry)"></i>
                }
                @if (m.planBar && expected(entry); as exp) {
                  <i
                    class="expected-mark"
                    data-expected
                    [attr.data-status]="status(entry)"
                    [style.left.%]="position(exp.date)"
                    [title]="'計畫應有進度 ' + exp.pct + '%'"></i>
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
                    [class.late]="m.actualClass.includes('late')"
                    [class.running]="m.actualClass.includes('running')"
                    [style.left.%]="position(m.actualBar.start)"
                    [style.width.%]="width(m.actualBar.start, m.actualBar.end)"
                    [title]="tooltip(entry)"></i>
                  @if (progressLabel(entry); as pct) {
                    <b class="gantt-progress" data-progress [attr.data-status]="status(entry)" [class.flip]="position(m.actualBar.end) > 85" [style.left.%]="position(m.actualBar.end)">{{ pct }}</b>
                  }
                }
                @if (forecastBar(entry); as f) {
                  <i class="forecast-bar" [style.left.%]="position(f.start)" [style.width.%]="width(f.start, f.end)" [title]="tooltip(entry)"></i>
                }
              }
            </div>

            <div class="gantt-stats">
              <span class="gantt-state-pill" [attr.data-state]="entry.state">{{ stateLabel(entry.state) }}</span>
              <span [class]="'gantt-variance-badge ' + varianceClass(entry)">{{ varianceOf(entry) }}</span>
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
  /** Row highlighted by the parent (from a gantt or grid click). */
  selectedId = input<string | null>(null);

  /** Expand state is owned by the parent when a grid shares it; see isPhaseOpen for what `toggled` means. */
  expandTasks = model(false);
  phaseToggles = model<ReadonlySet<string>>(new Set());
  phasesOpen = input(false);
  showCancelled = signal(false);
  showAllLinks = signal(false);

  /** 基準日: published view passes its publish date; the editor leaves it unset and follows the clock. */
  baseDate = input<string>();
  today = computed(() => this.baseDate() ?? localToday());
  private range = computed(() => ganttRange(this.entries(), [this.today()]));
  ticks = computed(() => ganttTicks(this.range()));
  cancelledCount = computed(() => this.entries().filter((e) => e.state === "cancelled").length);
  rows = computed(() =>
    ganttDisplayEntries(this.entries(), {
      expandTasks: this.expandTasks(),
      showCancelled: this.showCancelled(),
      expandedPhases: new Set(this.entries().filter((e) => this.isExpanded(e.id)).map((e) => e.id)),
    }),
  );
  private links = computed(() => ganttLinks(this.entries(), this.rows()));
  /** Links touching the selected row (its upstream and downstream, one hop). */
  private selectedLinks = computed(() => this.links().filter((l) => l.from === this.selectedId() || l.to === this.selectedId()));
  related = computed(() => new Set(this.selectedLinks().flatMap((l) => [l.from, l.to])));
  /** Elbow paths in a 100 x rowCount box: leave the predecessor end, drop to the successor row, enter its start. */
  drawnLinks = computed(() => {
    const rows = this.rows();
    const y = (id: string) => rows.findIndex((r) => r.id === id) + 0.5;
    const pick = (id: string, side: "start" | "end") => this.position(ganttAnchor(rows.find((r) => r.id === id)!, side));
    const active = new Set(this.selectedLinks());
    return (this.showAllLinks() ? this.links() : this.selectedLinks()).map((l) => {
      const x1 = pick(l.from, "end"), x2 = pick(l.to, "start");
      return { ...l, active: active.has(l), d: `M${x1} ${y(l.from)} H${x1} V${y(l.to)} H${x2}` };
    });
  });
  forecasts = computed(() => forecastEnds(this.entries(), this.today()));
  critical = computed(() => criticalChain(this.entries(), this.today()));
  forecastBar = (entry: GanttEntry) => {
    const from = this.marks(entry, this.today()).actualBar?.end ?? this.today();
    const to = this.forecasts().get(entry.id);
    return to && to > from ? { start: from, end: to } : null;
  };
  varianceOf = (e: GanttEntry) => varianceText(e, this.forecasts().get(e.id));
  varianceClass = (e: GanttEntry) => varianceBadgeClass(e, this.forecasts().get(e.id));
  todayPosition = computed(() => ganttPosition(this.range(), this.today()));
  todayLabel = computed(() => this.today().slice(5).replace("-", "/"));

  position = (date: string | null | undefined) => ganttPosition(this.range(), date);
  width = (start: string | null | undefined, end: string | null | undefined) => ganttWidth(this.range(), start, end);
  hasChildren = (phaseId: string) => hasChildTasks(this.entries(), phaseId, this.showCancelled());
  isExpanded = (phaseId: string) => isPhaseOpen({ expandTasks: this.expandTasks(), defaultOpen: this.phasesOpen(), toggled: this.phaseToggles() }, phaseId);
  togglePhase(phaseId: string) {
    const next = new Set(this.phaseToggles());
    if (!next.delete(phaseId)) next.add(phaseId);
    this.phaseToggles.set(next);
  }

  /** Marker for 計畫應有進度: sits on the plan bar at the base date (clamped to the plan range). */
  expected = (e: GanttEntry) => {
    const pct = expectedProgress(e, this.today());
    return pct === undefined ? null : { pct, date: this.today() < e.planStart! ? e.planStart : this.today() > e.planEnd! ? e.planEnd : this.today() };
  };
  status = (e: GanttEntry) => progressStatus(this.entries(), e, this.today());
  progressLabel = (e: GanttEntry) => progressText(this.entries(), e);
  marks = ganttMarks;
  tooltip = ganttTooltip;
  stateLabel = stateLabel;
  varianceText = varianceText;
  varianceBadgeClass = varianceBadgeClass;
}
