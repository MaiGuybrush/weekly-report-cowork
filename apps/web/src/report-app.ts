import {
  ChangeDetectorRef,
  Component,
  HostListener,
  inject,
  OnDestroy,
  OnInit,
} from "@angular/core";
import { DatePipe, JsonPipe } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { HttpClient } from "@angular/common/http";
import { ActivatedRoute, Router, RouterOutlet, Routes } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { API_BASE_URL, apiUrl, Auth, editorGuard, entryGuard, readerGuard } from "./auth";

type User = {
  empNo: string;
  name: string;
  role: string;
  section: string | null;
};
type Lease = { holder: string; expiresAt: string } | null;
type ItemDetails = {
  effectiveDate?: string;
  handover?: string;
  impact?: string;
  nextStep?: string;
  sourceLinks?: { label: string; url: string }[];
  pendingDecision?: {
    description: string;
    result?: string;
    newDueDate?: string;
    requiresFollowUp?: boolean;
  };
  previousCommitment?: string;
};
type Item = {
  id: string;
  continuityId: string;
  section: string;
  ownerSection: string;
  title: string;
  content: string;
  details: ItemDetails | string;
  status: string;
  version: number;
  lease: Lease;
  schedule?: ScheduleEntry[];
};
const detailsOf = (value: ItemDetails | string | undefined): ItemDetails =>
  typeof value === "string" ? JSON.parse(value) : (value ?? {});
type ProjectWork = {
  section: string;
  work: string;
  scheduleProposal: string | null;
  version: number;
  updatedBy: string;
  updatedAt: string;
};
type DependencyRef = { id: string; name: string; kind: string };
type DependencyWarning = { type: string; message: string; predecessorId: string; predecessorName: string };
type ScheduleEntry = {
  id: string;
  kind: "phase" | "task" | "milestone";
  name: string;
  owner?: string | null;
  phaseId?: string | null;
  unfinishedTasks?: string[] | null;
  baselineStart: string | null;
  baselineEnd: string | null;
  forecastStart: string | null;
  forecastEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
  baselineDate?: string | null;
  forecastDate?: string | null;
  actualDate?: string | null;
  version: number;
  state: "open" | "in-progress" | "completed" | "cancelled" | "pending" | "achieved";
  predecessors?: DependencyRef[];
  successors?: DependencyRef[];
  warnings?: DependencyWarning[];
};
type EcimMember = {
  userId: string;
  periodFrom: string | null;
  periodTo: string | null;
  status: string;
  error: string | null;
  lastSuccessAt: string | null;
};
type EcimCandidate = {
  id: string;
  status: string;
  type: string;
  reason: string | null;
  targetItemId: string | null;
  workId: string;
  periodFrom: string;
  periodTo: string;
  source: unknown;
  lastSourceValue: string | null;
  latestSourceValue: string | null;
  reportValue: string | null;
  humanOverride: boolean;
};
type SourceStatus = {
  section: string;
  status: string;
  periodFrom: string | null;
  periodTo: string | null;
  finishedAt: string | null;
};
type Report = {
  id: string;
  meetingDate: string;
  sections: string[];
  items: Item[];
};
type Conflict = {
  latest: Item;
  draft: { title: string; content: string; details: ItemDetails } | null;
  lease: Lease;
  error: string;
};
const labels: Record<string, string> = {
  summary: "本週管理摘要",
  projects: "進行中專案進度",
  operations: "系統維護與營運",
  personnel: "人力與組織異動",
  technology: "新技術評估",
  appendix: "工程師工作明細與來源連結",
};

@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet],
  template: "<router-outlet />",
})
export class App {}

@Component({
  standalone: true,
  imports: [FormsModule],
  template: ` <header>
      <h1>處會週報</h1>
      <span>{{ me?.name }} · {{ me?.role }}</span>
    </header>
    <main>
      <section class="card">
        <h2>週報</h2>
        @if (message) {
          <p class="message">{{ message }}</p>
        }
        @if (me?.role === "Guy") {
          <form (ngSubmit)="create()">
            <label
              >處會日期
              <input type="date" name="date" [(ngModel)]="meetingDate" required
            /></label>
            <button>建立或開啟週報</button>
          </form>
        }
        <ul>
          @for (report of reports; track report) {
            <li>
              <a href="#/reports/{{ report.id }}">{{ report.meetingDate }}</a>
            </li>
          }
        </ul>
      </section>
    </main>`,
})
export class Home implements OnInit {
  private http = inject(HttpClient);
  private router = inject(Router);
  private changes = inject(ChangeDetectorRef);
  me: User | null = null;
  reports: { id: string; meetingDate: string }[] = [];
  meetingDate = new Date().toISOString().slice(0, 10);
  message = "";
  async ngOnInit() {
    this.me = await firstValueFrom(this.http.get<User>("/api/me"));
    this.reports = await firstValueFrom(
      this.http.get<typeof this.reports>("/api/reports"),
    );
    this.changes.detectChanges();
  }
  async create() {
    try {
      const report = await firstValueFrom(
        this.http.post<Report>("/api/reports", {
          meetingDate: this.meetingDate,
        }),
      );
      await this.router.navigate(["/reports", report.id]);
    } catch {
      this.message = "無法建立週報。";
      this.changes.detectChanges();
    }
  }
}

@Component({
  standalone: true,
  imports: [DatePipe, FormsModule, JsonPipe],
  template: ` <header>
      <h1>
        處會週報 <small>{{ report?.meetingDate }}</small>
      </h1>
      <span>
        @if (me?.role === "Guy") {
          <button (click)="publish()">發布正式版</button>
        }
        <a href="#/">週報清單</a></span
      >
    </header>
    @if (report) {
      <main class="editor">
        <nav>
          <h2>章節與項目</h2>
          @if (publicationUrl) {
            <p><a [href]="publicationUrl">查看剛發布的固定版本</a></p>
          }
          @if (me?.role === "Head") {
            <section class="source-sync">
              <h3>eCIM 來源同步</h3>
              <button (click)="syncEcim()">同步本課工程師工作</button>
              @if (ecimMessage) {
                <p>{{ ecimMessage }}</p>
              }
              <ul>
                @for (member of ecimMembers; track member) {
                  <li>
                    {{ member.userId }} · {{ member.periodFrom || "未設定" }}–{{
                      member.periodTo || "未設定"
                    }}
                    ·
                    {{
                      member.status === "succeeded"
                        ? "成功"
                        : member.status === "failed"
                          ? "失敗"
                          : "尚未同步"
                    }}
                    · 上次成功：{{
                      member.lastSuccessAt
                        ? (member.lastSuccessAt | date: "short")
                        : "尚未成功"
                    }}
                    @if (member.error) {
                      <span> · {{ member.error }}</span>
                    }
                  </li>
                }
              </ul>
              @if (ecimCandidates.length) {
                <p>來源候選</p>
              }
              <ul>
                @for (candidate of ecimCandidates; track candidate) {
                  <li>
                    <strong>{{ candidate.workId }}</strong> ·
                    {{
                      candidate.type === "new-source"
                        ? "新增來源"
                        : candidate.type === "suspected-complete"
                          ? "疑似完成"
                          : candidate.type === "anomaly-alert"
                            ? "異常提示"
                            : candidate.reason || "來源變更"
                    }}
                    · {{ candidate.periodFrom }}–{{ candidate.periodTo }} ·
                    {{ candidate.status }}
                    @if (candidate.status === "new") {
                      <span
                        ><button (click)="decideCandidate(candidate, 'create')">
                          建立</button
                        ><button (click)="decideCandidate(candidate, 'defer')">
                          暫緩</button
                        ><button (click)="decideCandidate(candidate, 'ignore')">
                          忽略
                        </button></span
                      >
                    }
                    @if (candidate.status === "new") {
                      <span
                        ><button (click)="decideCandidate(candidate, 'merge')">
                          合併
                        </button></span
                      >
                    }
                    @if (candidate.targetItemId && candidate.status === "new") {
                      <span
                        ><button
                          (click)="decideCandidate(candidate, 'keep-manual')"
                        >
                          維持人工版</button
                        ><button
                          (click)="decideCandidate(candidate, 'apply-source')"
                        >
                          套用來源
                        </button></span
                      >
                    }
                    <details>
                      <summary>
                        比較來源與週報{{
                          candidate.humanOverride ? "（人工覆寫）" : ""
                        }}
                      </summary>
                      <p>上次來源：{{ candidate.lastSourceValue || "—" }}</p>
                      <p>
                        最新來源：{{
                          candidate.latestSourceValue ||
                            (candidate.source | json)
                        }}
                      </p>
                      <p>目前週報：{{ candidate.reportValue || "—" }}</p>
                    </details>
                  </li>
                }
              </ul>
            </section>
          }
          @for (section of report.sections; track section) {
            <section>
              <h3>{{ label(section) }}</h3>
              @if (canAdd(section)) {
                <button (click)="add(section)">新增項目</button>
              }
              @for (item of inSection(section); track item) {
                <button class="item" (click)="select(item)">
                  {{ item.title }}
                  @if (item.lease) {
                    <span>🔒</span>
                  }
                </button>
              }
            </section>
          }
        </nav>
        <article>
          @if (message) {
            <p class="message">{{ message }}</p>
          }
          @if (selected; as item) {
            <h2>{{ label(item.section) }}</h2>
            <p>
              共用版本 {{ item.version }}
              @if (item.lease) {
                <span
                  >· {{ item.lease.holder }} 編輯至
                  {{ item.lease.expiresAt | date: "short" }}</span
                >
              }
            </p>
            @if (!token) {
              <div>
                <h3>{{ item.title }}</h3>
                @if (item.section !== "personnel") {
                  <p>{{ item.content }}</p>
                }
                @if (item.section === "personnel") {
                  <p>
                    {{ detailsOf(item.details).effectiveDate }} ·
                    {{ detailsOf(item.details).handover }} ·
                    {{ detailsOf(item.details).impact }} ·
                    {{ detailsOf(item.details).nextStep }}
                  </p>
                }
                @if (detailsOf(item.details).previousCommitment) {
                  <p>
                    上週承諾：{{ detailsOf(item.details).previousCommitment }}
                  </p>
                }
                <button (click)="acquire()">開始編輯</button>
              </div>
            }
            @if (token) {
              <div>
                @if (item.section !== "personnel") {
                  <label
                    >標題
                    <input
                      [(ngModel)]="draftTitle"
                      (ngModelChange)="scheduleSave()"
                  /></label>
                }
                @if (item.section === "personnel") {
                  <label
                    >生效日期
                    <input
                      type="date"
                      [(ngModel)]="draftDetails.effectiveDate"
                      (ngModelChange)="scheduleSave()"
                  /></label>
                  <label
                    >職責或系統交接
                    <textarea
                      [(ngModel)]="draftDetails.handover"
                      (ngModelChange)="scheduleSave()"
                    ></textarea>
                  </label>
                  <label
                    >工作影響
                    <textarea
                      [(ngModel)]="draftDetails.impact"
                      (ngModelChange)="scheduleSave()"
                    ></textarea>
                  </label>
                  <label
                    >下一步
                    <textarea
                      [(ngModel)]="draftDetails.nextStep"
                      (ngModelChange)="scheduleSave()"
                    ></textarea>
                  </label>
                } @else {
                  <label
                    >內容
                    <textarea
                      rows="12"
                      [(ngModel)]="draftContent"
                      (ngModelChange)="scheduleSave()"
                    ></textarea>
                  </label>
                  @for (
                    link of draftDetails.sourceLinks;
                    track link;
                    let index = $index
                  ) {
                    <div class="source-link-row">
                      <label
                        >來源名稱
                        <input
                          [(ngModel)]="link.label"
                          (ngModelChange)="scheduleSave()" /></label
                      ><label
                        >來源連結 URL
                        <input
                          type="url"
                          [(ngModel)]="link.url"
                          (ngModelChange)="scheduleSave()" /></label
                      ><button (click)="removeSourceLink(index)">
                        移除連結
                      </button>
                    </div>
                  }
                  <button (click)="addSourceLink()">新增來源連結</button>
                  <label
                    >待決策事項
                    <textarea
                      [(ngModel)]="decisionDescription"
                      (ngModelChange)="scheduleSave()"
                    ></textarea>
                  </label>
                  @if (decisionDescription) {
                    <label
                      >決策結果
                      <textarea
                        [(ngModel)]="decisionResult"
                        (ngModelChange)="scheduleSave()"
                      ></textarea>
                    </label>
                  }
                  @if (decisionDescription) {
                    <label
                      >新期限
                      <input
                        type="date"
                        [(ngModel)]="decisionDueDate"
                        (ngModelChange)="scheduleSave()"
                    /></label>
                  }
                }
                <label
                  ><input
                    type="checkbox"
                    [checked]="draftStatus === 'closed'"
                    (change)="
                      draftStatus = $any($event.target).checked
                        ? 'closed'
                        : 'open';
                      scheduleSave()
                    "
                  />
                  本週結案（下週不再延續）</label
                >
                <p>{{ saveState }}</p>
                <button (click)="commit()">儲存完成</button
                ><button (click)="release()">取消編輯</button>
              </div>
            }
            @if (conflict) {
              <div class="conflict">
                <h3>編輯衝突</h3>
                <p>{{ conflict.error }}</p>
                <div class="compare">
                  <div>
                    <strong>最新共用版本 {{ conflict.latest.version }}</strong>
                    <p>{{ conflict.latest.title }}</p>
                    <p>{{ conflict.latest.content }}</p>
                    <pre>{{ detailsOf(conflict.latest.details) | json }}</pre>
                  </div>
                  <div>
                    <strong>我的私有草稿</strong>
                    <p>{{ conflict.draft?.title || draftTitle }}</p>
                    <p>{{ conflict.draft?.content || draftContent }}</p>
                    <pre>{{
                      conflict.draft?.details || currentDetails() | json
                    }}</pre>
                  </div>
                </div>
                <button (click)="reloadAndAcquire()">
                  重新取得租約並套用我的草稿
                </button>
              </div>
            }
            @if (
              me?.role === "Guy" &&
              item.lease &&
              item.lease.holder !== me?.empNo
            ) {
              <div>
                <label>接管理由 <input [(ngModel)]="takeoverReason" /></label
                ><button (click)="takeover()">接管租約</button>
              </div>
            }
            @if (item.section === "projects") {
              <section class="project-work">
                <h3>參與課別工作與時程建議</h3>
                @if (canMaintain(item)) {
                  <button (click)="assignParticipant()">指定參與課別</button>
                }
                @if (projectWork.length) {
                  <ul>
                    @for (entry of projectWork; track entry) {
                      <li>
                        <strong>{{ entry.section }}</strong> · {{ entry.work }}
                        @if (entry.scheduleProposal) {
                          <span> · 時程建議：{{ entry.scheduleProposal }}</span>
                        }
                      </li>
                    }
                  </ul>
                }
                @if (isParticipant) {
                  <div>
                    <label
                      >我承擔的工作
                      <textarea rows="4" [(ngModel)]="myProjectWork"></textarea>
                    </label>
                    <label
                      >時程變更建議（選填）
                      <input [(ngModel)]="myScheduleProposal" /></label
                    ><button (click)="saveProjectWork()">
                      送出給週報維護人
                    </button>
                  </div>
                }
              </section>
            }
            @if (item.section === "projects") {
              <section class="project-schedule">
                <div class="schedule-heading"><div><span class="eyebrow">PROJECT DELIVERY</span><h3>交付時程</h3><p>階段呈現整體交付，關鍵任務標明負責人與確認進度。</p></div><span class="schedule-count">{{ scheduleEntries.length }} 個時程項目</span></div>
                @if (scheduleEntries.length) {
                  <div class="gantt">
                    <p>
                      <strong>甘特圖</strong> · 報告日 {{ report.meetingDate }}
                    </p>
                    @for (entry of activeScheduleEntries(); track entry) {
                      <div class="gantt-row" (click)="editSchedule(entry)">
                        <span>{{ entry.name }}@if (entry.warnings?.length) { <small class="gantt-warn-icon" [title]="entry.warnings![0].message">⚠️</small> }</span>
                        <div class="gantt-track">
                          @if (entry.kind === 'milestone') {
                            <i
                              class="milestone-marker"
                              [attr.data-state]="entry.state"
                              [style.left.%]="
                                schedulePosition(
                                  entry.state === 'achieved'
                                    ? entry.actualDate
                                    : entry.forecastDate
                                )
                              "
                            ></i>
                          } @else {
                            <i
                              class="baseline"
                              [style.left.%]="
                                schedulePosition(entry.baselineStart)
                              "
                              [style.width.%]="
                                scheduleWidth(
                                  entry.baselineStart,
                                  entry.baselineEnd
                                )
                              "
                            ></i
                            ><i
                              class="forecast"
                              [style.left.%]="
                                schedulePosition(entry.forecastStart)
                              "
                              [style.width.%]="
                                scheduleWidth(
                                  entry.forecastStart,
                                  entry.forecastEnd
                                )
                              "
                            ></i>
                            @if (entry.actualStart || entry.actualEnd) {
                              <i
                                class="actual"
                                [style.left.%]="
                                  schedulePosition(
                                    entry.actualStart || entry.actualEnd
                                  )
                                "
                                [style.width.%]="
                                  scheduleWidth(
                                    entry.actualStart || entry.actualEnd,
                                    entry.actualEnd || entry.actualStart
                                  )
                                "
                              ></i>
                            }
                          }
                        </div>
                        <small>{{ entry.kind === 'milestone' ? (entry.state === 'achieved' ? '實際達成' : '最新目標') : '基準／預估／實際' }}</small>
                      </div>
                    }
                    @if (completedScheduleEntries().length) {
                      <details>
                        <summary>
                          已完成階段（{{ completedScheduleEntries().length }}）
                        </summary>
                        @for (
                          entry of completedScheduleEntries();
                          track entry
                        ) {
                          <div class="gantt-row">
                            <span>{{ entry.name }}</span>
                            <div class="gantt-track">
                              <i
                                class="baseline"
                                [style.left.%]="
                                  schedulePosition(entry.baselineStart)
                                "
                                [style.width.%]="
                                  scheduleWidth(
                                    entry.baselineStart,
                                    entry.baselineEnd
                                  )
                                "
                              ></i
                              ><i
                                class="forecast"
                                [style.left.%]="
                                  schedulePosition(entry.forecastStart)
                                "
                                [style.width.%]="
                                  scheduleWidth(
                                    entry.forecastStart,
                                    entry.forecastEnd
                                  )
                                "
                              ></i
                              ><i
                                class="actual"
                                [style.left.%]="
                                  schedulePosition(entry.actualStart)
                                "
                                [style.width.%]="
                                  scheduleWidth(
                                    entry.actualStart,
                                    entry.actualEnd
                                  )
                                "
                              ></i>
                            </div>
                          </div>
                        }
                      </details>
                    }
                  </div>
                }
                <ul>
                  @for (entry of scheduleDisplayEntries(); track entry.id) {
                    <li [class.schedule-task]="entry.kind === 'task'" [class.schedule-milestone]="entry.kind === 'milestone'">
                      <strong
                        >{{ entry.kind === "phase" ? "階段" : entry.kind === "task" ? "關鍵任務" : "重要里程碑" }}：{{
                          entry.name
                        }}</strong
                      >
                      <span class="schedule-state" [attr.data-state]="entry.state">{{ scheduleStateLabel(entry.state) }}</span>
                      @if (entry.kind === 'task') { <span class="schedule-owner">負責 {{ entry.owner }} · {{ phaseName(entry.phaseId) }}</span> }
                      @if (entry.kind === 'milestone') {
                        <span class="schedule-milestone-info">
                          · {{ entry.state === 'achieved' ? '實際達成' : '最新目標' }} {{ (entry.state === 'achieved' ? entry.actualDate : entry.forecastDate) || "—" }}
                          · 原始目標 {{ entry.baselineDate || "—" }}
                          @if (entry.state === 'achieved' && entry.forecastDate) {
                            · 最新目標 {{ entry.forecastDate }}
                          }
                          · 偏差 {{ scheduleMilestoneVariance(entry) }}
                        </span>
                      } @else {
                        · 原始計畫 {{ entry.baselineStart || "—" }}–{{
                          entry.baselineEnd || "—"
                        }}
                        · 目前計畫 {{ entry.forecastStart || "—" }}–{{
                          entry.forecastEnd || "—"
                        }}
                        · 實際 {{ entry.actualStart || "—" }}–{{
                          entry.actualEnd || "—"
                        }}
                        · 開始偏差 {{ scheduleStartVariance(entry) }}
                        · 完成偏差 {{ scheduleVariance(entry) }}
                        @if (entry.kind === 'phase' && entry.unfinishedTasks?.length) { <div class="schedule-warning">尚有 {{ entry.unfinishedTasks?.length }} 項未完成任務：{{ entry.unfinishedTasks?.join('、') }}。階段須由維護人另行確認。</div> }
                      }
                      @if (entry.predecessors?.length || entry.successors?.length) {
                        <div class="schedule-dependencies">
                          @for (p of entry.predecessors; track p.id) {
                            <span class="dependency-chip predecessor-chip">前置：{{ p.name }}</span>
                          }
                          @for (s of entry.successors; track s.id) {
                            <span class="dependency-chip successor-chip">後續：{{ s.name }}</span>
                          }
                        </div>
                      }
                      @if (entry.warnings?.length) {
                        <div class="schedule-warnings">
                          @for (w of entry.warnings; track w.message) {
                            <div class="schedule-warning-pill" [attr.data-type]="w.type">
                              <span class="warning-icon">{{ w.type === 'active-warning' ? '⚠️' : '⚡' }}</span>
                              <span>{{ w.message }}</span>
                            </div>
                          }
                          <small class="warning-hint">※ 警示允許例外工作繼續推進，不自動阻擋或更動日期。</small>
                        </div>
                      }
                      @if (canMaintain(item)) {
                        <button (click)="editSchedule(entry)">編輯</button>
                      }
                      <button (click)="loadScheduleHistory(entry)">
                        修訂紀錄
                      </button>
                    </li>
                  }
                </ul>
                @if (cancelledScheduleEntries().length) {
                  <div class="cancelled-section">
                    <details>
                      <summary class="cancelled-summary">
                        <span class="cancelled-badge">已取消項目（{{ cancelledScheduleEntries().length }}）</span>
                        <span class="cancelled-hint">點擊展開追溯被取消之承諾與原因；取消不干擾有效時程</span>
                      </summary>
                      <ul class="cancelled-list">
                        @for (entry of cancelledScheduleEntries(); track entry.id) {
                          <li class="cancelled-item">
                            <div class="cancelled-item-header">
                              <strong class="cancelled-name">
                                <del>{{ entry.kind === "phase" ? "階段" : entry.kind === "task" ? "關鍵任務" : "重要里程碑" }}：{{ entry.name }}</del>
                              </strong>
                              <span class="schedule-state" data-state="cancelled">已取消</span>
                              @if (entry.kind === 'task' && entry.owner) {
                                <span class="schedule-owner">原負責 {{ entry.owner }}</span>
                              }
                            </div>
                            <div class="cancelled-item-meta">
                              @if (entry.kind === 'milestone') {
                                <span>原始目標：{{ entry.baselineDate || "—" }}</span>
                                @if (entry.forecastDate) { <span> · 最新目標：{{ entry.forecastDate }}</span> }
                              } @else {
                                <span>原始計畫：{{ entry.baselineStart || "—" }}–{{ entry.baselineEnd || "—" }}</span>
                                @if (entry.actualStart) { <span class="actual-start-tag"> · 保留實際開始日：{{ entry.actualStart }}</span> }
                              }
                            </div>
                            <div class="cancelled-item-actions">
                              @if (canMaintain(item)) {
                                <button type="button" class="btn-reactivate" (click)="promptReactivate(entry)">重新啟用</button>
                                <button type="button" class="btn-edit-cancelled" (click)="editSchedule(entry)">查看詳情</button>
                              }
                              <button type="button" (click)="loadScheduleHistory(entry)">修訂紀錄</button>
                            </div>
                          </li>
                        }
                      </ul>
                    </details>
                  </div>
                }
                @if (baselineHistory.length) {
                  <ul class="schedule-history">
                    @for (change of baselineHistory; track change) {
                      <li>
                        <strong>{{ change.action === 'link-dependency' ? '建立相依關聯' : change.action === 'unlink-dependency' ? '解除相依關聯' : change.action === 'predecessor-updated' ? '前置計畫變動' : change.action }}</strong> · {{ change.actor }} · {{ change.at | date: "short" }} · {{ change.reason || "建立" }}
                        <details><summary>檢視前後狀態</summary><pre>{{ change.before | json }} → {{ change.after | json }}</pre></details>
                      </li>
                    }
                  </ul>
                }
                @if (canMaintain(item)) {
                  <div class="schedule-form">
                    <h4>{{ editingSchedule ? "編輯交付項目" : "新增交付項目" }}</h4>
                    <label
                      >類型
                      <select [(ngModel)]="scheduleDraft.kind" [disabled]="!!editingSchedule" (ngModelChange)="onScheduleKindChange()">
                        <option value="phase">階段</option>
                        <option value="task">關鍵任務</option>
                        <option value="milestone">重要里程碑</option>
                      </select></label
                    >
                    <label
                      >名稱 <input [(ngModel)]="scheduleDraft.name"
                    /></label>
                    @if (scheduleDraft.kind === 'task') {
                      <label>負責人或單位 <input [(ngModel)]="scheduleDraft.owner" required /></label>
                      <label>所屬階段 <select [(ngModel)]="scheduleDraft.phaseId"><option value="">直接隸屬專案</option>@for (phase of schedulePhases(); track phase.id) {<option [value]="phase.id">{{ phase.name }}</option>}</select></label>
                    }
                    @if (scheduleDraft.kind === 'milestone') {
                      @if (!editingSchedule) {
                        <label>目標日期 <input type="date" [(ngModel)]="scheduleDraft.targetDate" required /></label>
                      } @else {
                        <label>狀態
                          <select [(ngModel)]="scheduleDraft.state" (ngModelChange)="onMilestoneStateChange()">
                            <option value="pending">待達成</option>
                            <option value="achieved">已達成</option>
                            <option value="cancelled">已取消</option>
                          </select>
                        </label>
                        <label>原始目標 <input type="date" [(ngModel)]="scheduleDraft.baselineDate" /></label>
                        <label>最新目標 <input type="date" [(ngModel)]="scheduleDraft.forecastDate" /></label>
                        @if (scheduleDraft.state === 'achieved') {
                          <label>實際達成日 <input type="date" [(ngModel)]="scheduleDraft.actualDate" required /></label>
                        }
                      }
                    } @else {
                      @if (editingSchedule) {<label>狀態<select [(ngModel)]="scheduleDraft.state" (ngModelChange)="onScheduleStateChange()"><option value="open">開放</option><option value="in-progress">進行中</option><option value="completed">完成</option><option value="cancelled">取消</option></select></label>}
                    <label
                      >原始計畫開始
                      <input
                        type="date"
                        [(ngModel)]="scheduleDraft.baselineStart" /></label
                    ><label
                      >原始計畫結束
                      <input
                        type="date"
                        [(ngModel)]="scheduleDraft.baselineEnd"
                    /></label>
                    @if (editingSchedule) {
                    <label
                      >目前計畫開始
                      <input
                        type="date"
                        [(ngModel)]="scheduleDraft.forecastStart" /></label
                    ><label
                      >目前計畫結束
                      <input
                        type="date"
                        [(ngModel)]="scheduleDraft.forecastEnd"
                    /></label>
                    }
                    @if (editingSchedule) {
                    <label
                      >實際開始
                      <input
                        type="date"
                        [(ngModel)]="scheduleDraft.actualStart" /></label
                    ><label
                      >實際結束
                      <input type="date" [(ngModel)]="scheduleDraft.actualEnd"
                    /></label>
                    }
                    }
                    @if (editingSchedule) {
                      <label>操作<select [(ngModel)]="scheduleDraft.action" (ngModelChange)="onScheduleActionChange()"><option value="update">一般修訂</option><option value="correct-original">更正原始資料</option><option value="reopen">重新開啟</option><option value="cancel">取消項目</option><option value="reactivate">重新啟用</option></select></label>
                      <p class="schedule-note">{{ scheduleDraft.kind === 'milestone' ? '一般改期只調整最新目標；原始目標誤植時選擇「更正原始資料」。重開時自動清除實際達成日。' : '一般改期只調整目前計畫；原始日期誤植時選擇「更正原始資料」。重開時請清除實際完成日。' }}</p>

                      @if (scheduleDraft.action === 'cancel') {
                        @if (cancellationBlockerMessage(editingSchedule)) {
                          <div class="cancellation-blocker-alert">
                            <span class="blocker-icon">🛑</span>
                            <div>
                              <strong>無法直接取消項目</strong>
                              <p>{{ cancellationBlockerMessage(editingSchedule) }}</p>
                            </div>
                          </div>
                        } @else {
                          <div class="cancellation-ready-notice">
                            <span class="notice-icon">ℹ️</span>
                            <div>
                              <strong>取消確認說明</strong>
                              <p>取消項目將自動解除剩餘傳入的前置相依關係，並在歷史中留下原因。已提交項目不會被硬刪除，日後可重新啟用。</p>
                            </div>
                          </div>
                        }
                      }

                      @if (scheduleDraft.action === 'reactivate') {
                        <div class="reactivate-notice">
                          <span class="reactivate-icon">🔄</span>
                          <div>
                            <strong>重新啟用預覽</strong>
                            <p>
                              @if (editingSchedule.kind === 'milestone') {
                                里程碑將恢復為【待達成】狀態，並清除過去實際達成日。
                              } @else {
                                @if (editingSchedule.actualStart) {
                                  此項目保留實際開始日（{{ editingSchedule.actualStart }}），將恢復為【進行中】狀態。
                                } @else {
                                  此項目將恢復為【開放】狀態。
                                }
                              }
                              <br><small class="reactivate-hint">※ 相依關係與子任務歸屬不會自動恢復，若需要請於重新啟用後手動建立。</small>
                            </p>
                          </div>
                        </div>
                      }

                      @if (editingSchedule.kind === 'phase' && editingSchedule.state !== 'completed' && scheduleDraft.state === 'completed' && editingSchedule.unfinishedTasks?.length) { <label class="schedule-exception"><input type="checkbox" [(ngModel)]="scheduleDraft.acknowledgeIncompleteTasks" />我已檢視未完成任務，並在修改原因中說明提前確認階段的理由。</label> }
                      <label>修改原因 <input [(ngModel)]="scheduleDraft.reason" required placeholder="請填寫修訂或取消/重新啟用的原因" /></label>

                      <div class="dependency-panel">
                        <h5>前置項目管理</h5>
                        @if (editingSchedule.predecessors?.length) {
                          <ul class="dep-list">
                            @for (p of editingSchedule.predecessors; track p.id) {
                              <li class="dep-list-item">
                                <span class="dep-badge">[{{ p.kind === 'phase' ? '階段' : p.kind === 'task' ? '任務' : '里程碑' }}]</span>
                                <strong>{{ p.name }}</strong>
                                <button type="button" class="btn-remove-link" (click)="removeDependency(p.id)">解除關聯</button>
                              </li>
                            }
                          </ul>
                        } @else {
                          <p class="dep-empty">目前未設定前置項目。</p>
                        }
                        @if (editingSchedule.state !== 'cancelled' && candidatePredecessors(editingSchedule).length) {
                          <div class="dep-add-box">
                            <label>選擇前置項目
                              <select [(ngModel)]="selectedPredecessorId">
                                <option value="">請選擇前置項目...</option>
                                @for (cand of candidatePredecessors(editingSchedule); track cand.id) {
                                  <option [value]="cand.id">[{{ cand.kind === 'phase' ? '階段' : cand.kind === 'task' ? '任務' : '里程碑' }}] {{ cand.name }}</option>
                                }
                              </select>
                            </label>
                            <label>關聯原因
                              <input [(ngModel)]="linkReason" placeholder="例如：需待架構確認後方可進行" />
                            </label>
                            <button type="button" class="btn-add-link" (click)="addDependency()" [disabled]="!selectedPredecessorId || !linkReason.trim()">
                              建立前置關聯
                            </button>
                          </div>
                        }
                      </div>
                    }
                    <button (click)="saveSchedule()" [disabled]="!token || !scheduleDraft.name.trim() || (scheduleDraft.kind === 'task' && !scheduleDraft.owner.trim()) || (scheduleDraft.kind === 'milestone' && !editingSchedule && !scheduleDraft.targetDate) || (scheduleDraft.kind === 'milestone' && editingSchedule && scheduleDraft.state === 'achieved' && !scheduleDraft.actualDate) || (editingSchedule && !scheduleDraft.reason.trim()) || (editingSchedule?.kind === 'phase' && editingSchedule?.state !== 'completed' && scheduleDraft.state === 'completed' && editingSchedule?.unfinishedTasks?.length && !scheduleDraft.acknowledgeIncompleteTasks) || (editingSchedule && scheduleDraft.action === 'cancel' && !!cancellationBlockerMessage(editingSchedule))">
                      {{ editingSchedule ? "儲存時程" : "新增時程" }}
                    </button>
                    @if (editingSchedule) {
                      <button (click)="resetScheduleDraft()">取消</button>
                    } @else {
                      <button type="button" class="schedule-secondary" (click)="resetScheduleDraft()">捨棄未提交草稿</button>
                    }
                  </div>
                }
              </section>
            }
            <details>
              <summary>修訂紀錄</summary>
              <button (click)="loadHistory()">重新整理</button>
              <ul>
                @for (entry of history; track entry) {
                  <li>
                    {{ entry.at | date: "short" }} · {{ entry.actor }} ·
                    {{ entry.action }}
                    @if (entry.action === "commit") {
                      <span>
                        {{ entry.beforeVersion }} →
                        {{ entry.afterVersion }}</span
                      >
                    }
                    @if (entry.reason) {
                      <span> · {{ entry.reason }}</span>
                    }
                    @if (entry.afterDetails) {
                      <details>
                        <summary>欄位變更</summary>
                        <pre
                          >{{ entry.beforeDetails | json }} → {{
                            entry.afterDetails | json
                          }}</pre
                        >
                      </details>
                    }
                  </li>
                }
              </ul>
            </details>
          }
          @if (!selected) {
            <p>請選擇項目。</p>
          }
        </article>
      </main>
    }`,
})
export class ReportEditor implements OnInit, OnDestroy {
  private http = inject(HttpClient);
  private changes = inject(ChangeDetectorRef);
  private auth = inject(Auth);
  private apiBaseUrl = inject(API_BASE_URL);
  private route = inject(ActivatedRoute);
  report: Report | null = null;
  me: User | null = null;
  selected: Item | null = null;
  token = "";
  baseVersion = 0;
  draftTitle = "";
  draftContent = "";
  draftStatus = "open";
  draftDetails: ItemDetails = {};
  decisionDescription = "";
  decisionResult = "";
  decisionDueDate = "";
  detailsOf = detailsOf;
  currentDetails(): ItemDetails {
    if (this.selected?.section === "personnel")
      return {
        effectiveDate: this.draftDetails.effectiveDate,
        handover: this.draftDetails.handover,
        impact: this.draftDetails.impact,
        nextStep: this.draftDetails.nextStep,
      };
    const details: ItemDetails = {
      ...this.draftDetails,
      sourceLinks:
        this.draftDetails.sourceLinks?.filter((link) => link.url.trim()) ?? [],
    };
    if (this.decisionDescription.trim())
      details.pendingDecision = {
        description: this.decisionDescription,
        result: this.decisionResult,
        newDueDate: this.decisionDueDate,
        requiresFollowUp: this.draftDetails.pendingDecision?.requiresFollowUp,
      };
    else delete details.pendingDecision;
    return details;
  }
  loadDetails(value: ItemDetails | string | undefined) {
    this.draftDetails = { ...detailsOf(value) };
    this.draftDetails.sourceLinks =
      this.draftDetails.sourceLinks?.map((link) => ({ ...link })) ?? [];
    this.decisionDescription =
      this.draftDetails.pendingDecision?.description ?? "";
    this.decisionResult = this.draftDetails.pendingDecision?.result ?? "";
    this.decisionDueDate = this.draftDetails.pendingDecision?.newDueDate ?? "";
  }
  addSourceLink() {
    this.draftDetails.sourceLinks ??= [];
    this.draftDetails.sourceLinks.push({ label: "來源", url: "" });
    this.changes.detectChanges();
  }
  removeSourceLink(index: number) {
    this.draftDetails.sourceLinks?.splice(index, 1);
    this.scheduleSave();
  }
  saveState = "";
  message = "";
  conflict: Conflict | null = null;
  history: any[] = [];
  projectWork: ProjectWork[] = [];
  myProjectWork = "";
  myScheduleProposal = "";
  myProjectWorkVersion = 0;
  isParticipant = false;
  scheduleEntries: ScheduleEntry[] = [];
  editingSchedule: ScheduleEntry | null = null;
  scheduleDraft = this.emptyScheduleDraft();
  selectedPredecessorId = "";
  linkReason = "";
  baselineHistory: any[] = [];
  ecimMembers: EcimMember[] = [];
  ecimCandidates: EcimCandidate[] = [];
  ecimMessage = "";
  takeoverReason = "";
  publicationUrl = "";
  private pendingPublicationRequestId = "";
  private saveTimer?: ReturnType<typeof setTimeout>;
  private renewTimer?: ReturnType<typeof setInterval>;
  private reportId = this.route.snapshot.paramMap.get("id")!;
  label(section: string) {
    return labels[section] ?? section;
  }
  inSection(section: string) {
    return this.report?.items.filter((item) => item.section === section) ?? [];
  }
  canAdd(_section: string) {
    return this.me?.role === "Guy" || this.me?.role === "Head";
  }
  async ngOnInit() {
    this.me = await firstValueFrom(this.http.get<User>("/api/me"));
    await this.refresh();
    await this.loadEcimStatus();
  }
  ngOnDestroy() {
    clearTimeout(this.saveTimer);
    clearInterval(this.renewTimer);
    this.releaseOnExit();
  }
  @HostListener("window:pagehide") onPageHide() {
    this.releaseOnExit();
  }
  private releaseOnExit() {
    if (!this.selected || !this.token) return;
    const itemId = this.selected.id;
    const leaseToken = this.token;
    this.token = "";
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.auth.token()}`,
    };
    fetch(apiUrl(this.apiBaseUrl, `/api/items/${itemId}/private-draft`), {
      method: "PUT",
      keepalive: true,
      headers,
      body: JSON.stringify({
        title: this.draftTitle,
        content: this.selected.section === "personnel" ? "" : this.draftContent,
        details: this.currentDetails(),
        status: this.draftStatus,
      }),
    }).catch(() => {});
    fetch(apiUrl(this.apiBaseUrl, `/api/items/${itemId}/lease`), {
      method: "DELETE",
      keepalive: true,
      headers,
      body: JSON.stringify({ token: leaseToken }),
    }).catch(() => {});
  }
  async refresh() {
    this.report = await firstValueFrom(
      this.http.get<Report>(`/api/reports/${this.reportId}`),
    );
    if (this.selected)
      this.selected =
        this.report.items.find((item) => item.id === this.selected?.id) ?? null;
    this.changes.detectChanges();
  }
  async loadEcimStatus() {
    if (this.me?.role !== "Head") return;
    try {
      const status = await firstValueFrom(
        this.http.get<{ members: EcimMember[] }>(
          `/api/reports/${this.reportId}/ecim-sync`,
        ),
      );
      this.ecimMembers = status.members;
      this.ecimCandidates = await firstValueFrom(
        this.http.get<EcimCandidate[]>(
          `/api/reports/${this.reportId}/ecim-candidates`,
        ),
      );
    } catch {
      this.ecimMessage = "尚未設定或無法載入 eCIM 來源狀態。";
    }
    this.changes.detectChanges();
  }
  async syncEcim() {
    try {
      const run = await firstValueFrom(
        this.http.post<{ status: string }>(
          `/api/reports/${this.reportId}/ecim-sync`,
          {},
        ),
      );
      this.ecimMessage =
        run.status === "succeeded"
          ? "本課來源同步完成。"
          : "同步完成，但部分成員失敗。";
      await this.loadEcimStatus();
    } catch {
      this.ecimMessage = "來源同步失敗。";
      this.changes.detectChanges();
    }
  }
  async decideCandidate(candidate: EcimCandidate, action: string) {
    const targetItemId =
      candidate.targetItemId ??
      (action === "merge" ? prompt("要合併的項目 ID")?.trim() : undefined);
    if (action === "merge" && !targetItemId) return;
    try {
      await firstValueFrom(
        this.http.post(
          `/api/reports/${this.reportId}/ecim-candidates/${candidate.id}/decision`,
          { action, targetItemId },
        ),
      );
      this.ecimMessage = "已記錄候選決策。";
      await this.loadEcimStatus();
      await this.refresh();
    } catch {
      this.ecimMessage = "無法套用候選決策。";
      this.changes.detectChanges();
    }
  }
  async add(section: string) {
    const title = prompt("項目標題");
    if (!title?.trim()) return;
    const ownerSection =
      section === "personnel" && this.me?.role === "Guy"
        ? prompt("相關課別（例如 s1）")?.trim()
        : undefined;
    if (section === "personnel" && this.me?.role === "Guy" && !ownerSection)
      return;
    try {
      const item = await firstValueFrom(
        this.http.post<{ id: string }>(`/api/reports/${this.reportId}/items`, {
          section,
          title,
          ownerSection,
        }),
      );
      await this.refresh();
      this.select(this.report!.items.find((i) => i.id === item.id)!);
    } catch {
      this.message = "無法新增項目。";
      this.changes.detectChanges();
    }
  }
  async select(item: Item) {
    if (this.token) {
      clearTimeout(this.saveTimer);
      await this.save();
      if (this.saveState !== "私人草稿已儲存") {
        this.message = "請先確認草稿儲存成功。";
        return;
      }
      await this.release();
    }
    clearInterval(this.renewTimer);
    clearTimeout(this.saveTimer);
    this.selected = item;
    this.token = "";
    this.conflict = null;
    this.history = [];
    this.message = "";
    this.draftTitle = item.title;
    this.draftContent = item.content;
    this.draftStatus = item.status;
    this.loadDetails(item.details);
    this.projectWork = [];
    this.myProjectWork = "";
    this.myScheduleProposal = "";
    this.myProjectWorkVersion = 0;
    this.isParticipant = false;
    this.scheduleEntries = [];
    this.resetScheduleDraft();
    if (item.section === "projects") {
      await this.loadProjectWork();
      await this.loadSchedule();
    }
    this.changes.detectChanges();
  }
  canMaintain(item: Item) {
    return (
      item.section === "projects" &&
      (this.me?.role === "Guy" ||
        (this.me?.role === "Head" && this.me.section === item.ownerSection))
    );
  }
  async assignParticipant() {
    if (!this.selected) return;
    const section = prompt("參與課別（例如 s2）");
    if (!section?.trim()) return;
    try {
      await firstValueFrom(
        this.http.post(`/api/items/${this.selected.id}/project-participants`, {
          section: section.trim(),
        }),
      );
      this.message = "已指定參與課別。";
    } catch {
      this.message = "無法指定參與課別。";
    }
    this.changes.detectChanges();
  }
  async loadProjectWork() {
    if (!this.selected) return;
    try {
      this.projectWork = await firstValueFrom(
        this.http.get<ProjectWork[]>(
          `/api/items/${this.selected.id}/project-work`,
        ),
      );
      const mine = this.projectWork.find(
        (entry) => entry.section === this.me?.section,
      );
      this.isParticipant = !!mine || !this.canMaintain(this.selected);
      this.myProjectWork = mine?.work ?? "";
      this.myScheduleProposal = mine?.scheduleProposal ?? "";
      this.myProjectWorkVersion = mine?.version ?? 0;
    } catch {
      this.isParticipant = false;
    }
  }
  async saveProjectWork() {
    if (!this.selected) return;
    try {
      await firstValueFrom(
        this.http.put(`/api/items/${this.selected.id}/project-work`, {
          work: this.myProjectWork,
          scheduleProposal: this.myScheduleProposal,
          baseVersion: this.myProjectWorkVersion,
        }),
      );
      await this.loadProjectWork();
      this.message = "已送出給週報維護人。";
    } catch {
      this.message = "送出參與工作失敗。";
    }
    this.changes.detectChanges();
  }
  emptyScheduleDraft() {
    return {
      kind: "phase" as ScheduleEntry["kind"],
      name: "",
      owner: "",
      phaseId: "",
      acknowledgeIncompleteTasks: false,
      targetDate: "",
      baselineDate: "",
      forecastDate: "",
      actualDate: "",
      baselineStart: "",
      baselineEnd: "",
      forecastStart: "",
      forecastEnd: "",
      actualStart: "",
      actualEnd: "",
      baselineChangeReason: "",
      state: "open" as ScheduleEntry["state"],
      reason: "",
      action: "update",
    };
  }
  onScheduleKindChange() {
    if (this.scheduleDraft.kind === "milestone") {
      this.scheduleDraft.state = "pending";
      this.scheduleDraft.owner = "";
      this.scheduleDraft.phaseId = "";
    } else if (this.scheduleDraft.state === "pending" || this.scheduleDraft.state === "achieved") {
      this.scheduleDraft.state = "open";
    }
    this.changes.detectChanges();
  }
  onMilestoneStateChange() {
    if (this.scheduleDraft.state === "cancelled") {
      this.scheduleDraft.action = "cancel";
      this.onScheduleActionChange();
      return;
    } else if (this.scheduleDraft.action === "cancel") {
      this.scheduleDraft.action = "update";
    }
    if (this.scheduleDraft.state !== "achieved") {
      this.scheduleDraft.actualDate = "";
    }
    this.changes.detectChanges();
  }
  onScheduleStateChange() {
    if (this.scheduleDraft.state === "cancelled") {
      this.scheduleDraft.action = "cancel";
      this.onScheduleActionChange();
      return;
    } else if (this.scheduleDraft.action === "cancel") {
      this.scheduleDraft.action = "update";
    }
    this.changes.detectChanges();
  }
  onScheduleActionChange() {
    if (this.scheduleDraft.action === "cancel") {
      this.scheduleDraft.state = "cancelled";
      if (this.scheduleDraft.kind === "milestone") this.scheduleDraft.actualDate = "";
      else this.scheduleDraft.actualEnd = "";
    } else if (this.scheduleDraft.action === "reactivate") {
      if (this.scheduleDraft.kind === "milestone") {
        this.scheduleDraft.state = "pending";
        this.scheduleDraft.actualDate = "";
      } else {
        this.scheduleDraft.state = this.editingSchedule?.actualStart ? "in-progress" : "open";
        this.scheduleDraft.actualEnd = "";
        this.scheduleDraft.phaseId = "";
      }
    } else if (this.scheduleDraft.action === "reopen") {
      if (this.scheduleDraft.kind === "milestone") {
        this.scheduleDraft.state = "pending";
        this.scheduleDraft.actualDate = "";
      } else {
        this.scheduleDraft.state = "in-progress";
        this.scheduleDraft.actualEnd = "";
      }
    }
    this.changes.detectChanges();
  }
  cancellationBlockerMessage(entry: ScheduleEntry | null): string | null {
    if (!entry) return null;
    if (entry.successors?.length) {
      const names = entry.successors.map((s) => `「${s.name}」`).join("、");
      return `此項目尚有 ${entry.successors.length} 個後續相依項目（${names}）。依規定取消前必須先逐一解除或替換其相依關聯。`;
    }
    if (entry.kind === "phase") {
      const activeTasks = this.scheduleEntries.filter(
        (e) => e.kind === "task" && e.phaseId === entry.id && e.state !== "cancelled",
      );
      if (activeTasks.length) {
        const names = activeTasks.map((t) => `「${t.name}」`).join("、");
        return `此階段尚有 ${activeTasks.length} 個進行中或未取消的子任務（${names}）。取消階段前，必須逐一重新歸屬、移到專案直屬或取消子任務。`;
      }
    }
    return null;
  }
  promptReactivate(entry: ScheduleEntry) {
    this.editSchedule(entry);
    this.scheduleDraft.action = "reactivate";
    this.onScheduleActionChange();
    this.scheduleDraft.reason = "";
    this.message = `已切換為重新啟用「${entry.name}」。請在下方表單填寫原因後儲存。`;
    this.changes.detectChanges();
  }
  async loadSchedule() {
    if (!this.selected) return;
    try {
      this.scheduleEntries = await firstValueFrom(
        this.http.get<ScheduleEntry[]>(
          `/api/items/${this.selected.id}/schedule`,
        ),
      );
    } catch {
      this.scheduleEntries = [];
    }
  }
  private ganttDates() {
    return this.scheduleEntries
      .flatMap((entry) => [
        entry.baselineStart,
        entry.baselineEnd,
        entry.forecastStart,
        entry.forecastEnd,
        entry.actualStart,
        entry.actualEnd,
        entry.baselineDate,
        entry.forecastDate,
        entry.actualDate,
      ])
      .filter((date): date is string => !!date)
      .map((date) => new Date(`${date}T00:00:00`).getTime());
  }
  schedulePosition(date: string | null | undefined) {
    const dates = this.ganttDates();
    if (!date || !dates.length) return 0;
    const min = Math.min(...dates),
      max = Math.max(...dates);
    return max === min
      ? 0
      : Math.max(
          0,
          Math.min(
            100,
            ((new Date(`${date}T00:00:00`).getTime() - min) * 100) /
              (max - min),
          ),
        );
  }
  scheduleWidth(start: string | null | undefined, end: string | null | undefined) {
    if (!start || !end) return 2;
    return Math.max(
      2,
      this.schedulePosition(end) - this.schedulePosition(start),
    );
  }
  completedScheduleEntries() {
    return this.scheduleEntries.filter(
      (entry) => entry.kind === "phase" && entry.state === "completed",
    );
  }
  activeScheduleEntries() {
    return this.scheduleEntries.filter(
      (entry) =>
        entry.state !== "cancelled" &&
        ((entry.kind === "phase" && entry.state !== "completed") ||
          entry.kind === "milestone"),
    );
  }
  schedulePhases() {
    return this.scheduleEntries.filter(entry => entry.kind === "phase" && entry.state !== "cancelled" && (entry.state !== "completed" || entry.id === this.scheduleDraft.phaseId || this.editingSchedule?.kind === "task" && this.scheduleDraft.state === "completed"));
  }
  phaseName(id: string | null | undefined) {
    return id ? this.scheduleEntries.find(entry => entry.id === id)?.name ?? "未知階段" : "專案直屬";
  }
  scheduleDisplayEntries() {
    const active = this.scheduleEntries.filter(entry => entry.state !== "cancelled");
    const phases = active.filter(entry => entry.kind === "phase");
    return [
      ...phases.flatMap(phase => [phase, ...active.filter(entry => entry.kind === "task" && entry.phaseId === phase.id)]),
      ...active.filter(entry => entry.kind === "task" && !entry.phaseId),
      ...active.filter(entry => entry.kind === "milestone"),
      ...active.filter(entry => entry.kind !== "phase" && entry.kind !== "task" && entry.kind !== "milestone"),
    ];
  }
  cancelledScheduleEntries() {
    return this.scheduleEntries.filter(entry => entry.state === "cancelled");
  }
  editSchedule(entry: ScheduleEntry) {
    this.editingSchedule = entry;
    this.selectedPredecessorId = "";
    this.linkReason = "";
    this.scheduleDraft = {
      kind: entry.kind,
      name: entry.name,
      owner: entry.owner ?? "",
      phaseId: entry.phaseId ?? "",
      acknowledgeIncompleteTasks: false,
      targetDate: entry.forecastDate ?? entry.baselineDate ?? "",
      baselineDate: entry.baselineDate ?? "",
      forecastDate: entry.forecastDate ?? "",
      actualDate: entry.actualDate ?? "",
      baselineStart: entry.baselineStart ?? "",
      baselineEnd: entry.baselineEnd ?? "",
      forecastStart: entry.forecastStart ?? "",
      forecastEnd: entry.forecastEnd ?? "",
      actualStart: entry.actualStart ?? "",
      actualEnd: entry.actualEnd ?? "",
      baselineChangeReason: "",
      state: entry.state,
      reason: "",
      action: "update",
    };
    this.changes.detectChanges();
  }
  scheduleStateLabel(state: ScheduleEntry["state"]) {
    return (
      {
        open: "開放",
        "in-progress": "進行中",
        completed: "完成",
        cancelled: "取消",
        pending: "待達成",
        achieved: "已達成",
      }[state] ?? state
    );
  }
  scheduleMilestoneVariance(entry: ScheduleEntry) {
    if (!entry.baselineDate) return "—";
    const date = entry.state === "achieved" ? entry.actualDate : entry.forecastDate;
    if (!date) return "—";
    const days = Math.round((Date.parse(date) - Date.parse(entry.baselineDate)) / 86400000);
    return `${days > 0 ? "+" : ""}${days} 天`;
  }
  scheduleVariance(entry: ScheduleEntry) {
    const end = entry.actualEnd || entry.forecastEnd;
    if (!entry.baselineEnd || !end) return "—";
    const days = Math.round((Date.parse(end) - Date.parse(entry.baselineEnd)) / 86400000);
    return `${days > 0 ? "+" : ""}${days} 天`;
  }
  scheduleStartVariance(entry: ScheduleEntry) {
    const start = entry.actualStart || entry.forecastStart;
    if (!entry.baselineStart || !start) return "—";
    const days = Math.round((Date.parse(start) - Date.parse(entry.baselineStart)) / 86400000);
    return `${days > 0 ? "+" : ""}${days} 天`;
  }
  async loadScheduleHistory(entry: ScheduleEntry) {
    if (!this.selected) return;
    try {
      this.baselineHistory = await firstValueFrom(
        this.http.get<any[]>(
          `/api/items/${this.selected.id}/schedule/${entry.id}/history`,
        ),
      );
    } catch {
      this.message = "無法載入修訂紀錄。";
    }
    this.changes.detectChanges();
  }
  resetScheduleDraft() {
    this.editingSchedule = null;
    this.scheduleDraft = this.emptyScheduleDraft();
    this.selectedPredecessorId = "";
    this.linkReason = "";
    this.changes.detectChanges();
  }
  candidatePredecessors(entry: ScheduleEntry) {
    const existing = new Set(entry.predecessors?.map((p) => p.id) ?? []);
    return this.scheduleEntries.filter((e) => {
      if (e.id === entry.id || existing.has(e.id)) return false;
      if (e.state === "cancelled") return false;
      if (entry.kind === "phase" && e.kind === "task" && e.phaseId === entry.id) return false;
      if (entry.kind === "task" && entry.phaseId && e.id === entry.phaseId) return false;
      return true;
    });
  }
  async addDependency() {
    if (!this.selected || !this.editingSchedule || !this.selectedPredecessorId || !this.linkReason.trim()) return;
    try {
      const result = (await firstValueFrom(
        this.http.post(`/api/items/${this.selected.id}/schedule/dependencies`, {
          predecessorId: this.selectedPredecessorId,
          successorId: this.editingSchedule.id,
          reason: this.linkReason.trim(),
          token: this.token,
          baseProjectVersion: this.baseVersion,
        }),
      )) as { projectVersion: number };
      this.baseVersion = result.projectVersion;
      await this.loadSchedule();
      this.editingSchedule = this.scheduleEntries.find((e) => e.id === this.editingSchedule?.id) ?? null;
      this.selectedPredecessorId = "";
      this.linkReason = "";
      this.message = "已建立前置關聯。";
    } catch (error: any) {
      if (error.status === 409) {
        this.conflict = error.error;
        if (error.error?.latest?.schedule) this.scheduleEntries = error.error.latest.schedule;
      }
      this.message = error.error?.error || "無法建立前置關聯。";
    }
    this.changes.detectChanges();
  }
  async removeDependency(predecessorId: string) {
    if (!this.selected || !this.editingSchedule) return;
    const reason = prompt("請輸入解除前置關聯的原因：")?.trim();
    if (!reason) return;
    try {
      const result = (await firstValueFrom(
        this.http.post(`/api/items/${this.selected.id}/schedule/dependencies/delete`, {
          predecessorId,
          successorId: this.editingSchedule.id,
          reason,
          token: this.token,
          baseProjectVersion: this.baseVersion,
        }),
      )) as { projectVersion: number };
      this.baseVersion = result.projectVersion;
      await this.loadSchedule();
      this.editingSchedule = this.scheduleEntries.find((e) => e.id === this.editingSchedule?.id) ?? null;
      this.message = "已解除前置關聯。";
    } catch (error: any) {
      if (error.status === 409) {
        this.conflict = error.error;
        if (error.error?.latest?.schedule) this.scheduleEntries = error.error.latest.schedule;
      }
      this.message = error.error?.error || "無法解除前置關聯。";
    }
    this.changes.detectChanges();
  }
  async saveSchedule() {
    if (!this.selected) return;
    const value = (date: string) => date || null;
    let body: any;
    const isCancel = this.scheduleDraft.action === "cancel";
    const isReactivate = this.scheduleDraft.action === "reactivate";
    if (this.scheduleDraft.kind === "milestone") {
      body = {
        kind: "milestone",
        name: this.scheduleDraft.name.trim(),
        targetDate: value(this.scheduleDraft.targetDate),
        baselineDate: value(this.scheduleDraft.baselineDate || this.scheduleDraft.targetDate),
        forecastDate: value(this.scheduleDraft.forecastDate || this.scheduleDraft.targetDate),
        actualDate: (isCancel || isReactivate) ? null : value(this.scheduleDraft.actualDate),
        state: isCancel ? "cancelled" : isReactivate ? "pending" : (this.editingSchedule ? this.scheduleDraft.state : "pending"),
        reason: this.scheduleDraft.reason ? this.scheduleDraft.reason.trim() : null,
        action: this.scheduleDraft.action,
      };
    } else {
      const targetState = isCancel
        ? "cancelled"
        : isReactivate
          ? (this.editingSchedule?.actualStart ? "in-progress" : "open")
          : this.scheduleDraft.state;
      body = {
        ...this.scheduleDraft,
        owner: this.scheduleDraft.kind === "task" ? this.scheduleDraft.owner.trim() : null,
        phaseId: (isCancel || isReactivate) ? null : (this.scheduleDraft.kind === "task" ? this.scheduleDraft.phaseId || null : null),
        baselineStart: value(this.scheduleDraft.baselineStart),
        baselineEnd: value(this.scheduleDraft.baselineEnd),
        forecastStart: this.editingSchedule ? value(this.scheduleDraft.forecastStart) : value(this.scheduleDraft.baselineStart),
        forecastEnd: this.editingSchedule ? value(this.scheduleDraft.forecastEnd) : value(this.scheduleDraft.baselineEnd),
        actualStart: value(this.scheduleDraft.actualStart),
        actualEnd: (isCancel || isReactivate) ? null : value(this.scheduleDraft.actualEnd),
        state: targetState,
      };
    }
    try {
      let result: { projectVersion: number };
      if (this.editingSchedule)
        result = (await firstValueFrom(
          this.http.put(
            `/api/items/${this.selected.id}/schedule/${this.editingSchedule.id}`,
            { ...body, baseVersion: this.editingSchedule.version, token: this.token, baseProjectVersion: this.baseVersion },
          ),
        )) as { projectVersion: number };
      else
        result = (await firstValueFrom(
          this.http.post(`/api/items/${this.selected.id}/schedule`, { ...body, token: this.token, baseProjectVersion: this.baseVersion }),
        )) as { projectVersion: number };
      this.baseVersion = result.projectVersion;
      await this.loadSchedule();
      this.resetScheduleDraft();
      this.message = "已儲存結構化時程。";
    } catch (error: any) {
      if (error.status === 409) {
        this.conflict = error.error;
        if (error.error?.latest?.schedule) this.scheduleEntries = error.error.latest.schedule;
      }
      this.message = error.error?.error || "無法儲存時程，請檢查日期、狀態與原因。";
    }
    this.changes.detectChanges();
  }
  async acquire() {
    if (!this.selected) return;
    try {
      const lease = await firstValueFrom(
        this.http.post<{ token: string; baseVersion: number }>(
          `/api/items/${this.selected.id}/lease`,
          {},
        ),
      );
      this.token = lease.token;
      this.baseVersion = lease.baseVersion;
      this.renewTimer = setInterval(() => this.renew(), 5 * 60 * 1000);
      try {
        const draft = await firstValueFrom(
          this.http.get<{
            title: string;
            content: string;
            details: ItemDetails;
            status: string;
          }>(`/api/items/${this.selected.id}/private-draft`),
        );
        this.draftTitle = draft.title;
        this.draftContent = draft.content;
        this.draftStatus = draft.status;
        this.loadDetails(draft.details);
      } catch {
        /* no existing draft */
      }
    } catch (error: any) {
      this.conflict = error.error;
      await this.refresh();
    }
    this.changes.detectChanges();
  }
  async renew() {
    if (!this.selected || !this.token) return;
    try {
      await firstValueFrom(
        this.http.post(`/api/items/${this.selected.id}/lease/renew`, {
          token: this.token,
        }),
      );
    } catch (error: any) {
      this.conflict = error.error;
      clearInterval(this.renewTimer);
      this.changes.detectChanges();
    }
  }
  scheduleSave() {
    this.saveState = "儲存中";
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.save(), 700);
  }
  async save() {
    if (!this.selected) return;
    try {
      await firstValueFrom(
        this.http.put(`/api/items/${this.selected.id}/private-draft`, {
          title: this.draftTitle,
          content:
            this.selected.section === "personnel" ? "" : this.draftContent,
          details: this.currentDetails(),
          status: this.draftStatus,
        }),
      );
      this.saveState = "私人草稿已儲存";
    } catch {
      this.saveState = "草稿儲存失敗";
    }
    this.changes.detectChanges();
  }
  async commit() {
    if (!this.selected) return;
    clearTimeout(this.saveTimer);
    await this.save();
    if (this.saveState !== "私人草稿已儲存") return;
    try {
      await firstValueFrom(
        this.http.post(`/api/items/${this.selected.id}/commit`, {
          token: this.token,
          baseVersion: this.baseVersion,
          status: this.draftStatus,
        }),
      );
      this.token = "";
      clearInterval(this.renewTimer);
      this.conflict = null;
      await this.refresh();
      this.message = "已儲存完成。";
    } catch (error: any) {
      this.conflict = error.error;
      this.message = "提交遇到衝突，私有草稿已保留。";
      this.changes.detectChanges();
    }
  }
  async release() {
    if (!this.selected) return;
    clearTimeout(this.saveTimer);
    await this.save();
    if (this.saveState !== "私人草稿已儲存") {
      this.message = "請先確認草稿儲存成功。";
      return;
    }
    try {
      await firstValueFrom(
        this.http.request("DELETE", `/api/items/${this.selected.id}/lease`, {
          body: { token: this.token },
        }),
      );
    } catch {}
    this.token = "";
    clearInterval(this.renewTimer);
    await this.refresh();
  }
  async takeover() {
    if (!this.selected || !this.takeoverReason.trim()) return;
    try {
      const lease = await firstValueFrom(
        this.http.post<{ token: string; baseVersion: number }>(
          `/api/items/${this.selected.id}/lease/takeover`,
          { reason: this.takeoverReason },
        ),
      );
      this.token = lease.token;
      this.baseVersion = lease.baseVersion;
      this.conflict = null;
      this.renewTimer = setInterval(() => this.renew(), 5 * 60 * 1000);
      await this.refresh();
      await this.loadHistory();
    } catch {
      this.message = "接管失敗。";
      this.changes.detectChanges();
    }
  }
  async reloadAndAcquire() {
    await this.refresh();
    this.token = "";
    this.conflict = null;
    await this.acquire();
  }
  async publish() {
    try {
      this.pendingPublicationRequestId ||=
        sessionStorage.getItem(`publication-request:${this.reportId}`) ??
        crypto.randomUUID();
      sessionStorage.setItem(
        `publication-request:${this.reportId}`,
        this.pendingPublicationRequestId,
      );
      const publication = await firstValueFrom(
        this.http.post<{ id: string; version: number }>(
          `/api/reports/${this.reportId}/publications`,
          { requestId: this.pendingPublicationRequestId },
        ),
      );
      this.pendingPublicationRequestId = "";
      sessionStorage.removeItem(`publication-request:${this.reportId}`);
      this.publicationUrl = `#/publications/${publication.id}`;
      this.message = `已發布正式版 ${publication.version}。`;
      this.changes.detectChanges();
    } catch {
      this.message = "發布失敗。";
      this.changes.detectChanges();
    }
  }
  async loadHistory() {
    if (this.selected)
      this.history = await firstValueFrom(
        this.http.get<any[]>(`/api/items/${this.selected.id}/history`),
      );
    this.changes.detectChanges();
  }
}

@Component({
  standalone: true,
  imports: [DatePipe],
  template: ` <header>
      <h1>
        正式處會週報 <small>{{ publication?.meetingDate }}</small>
      </h1>
      <a href="#/">週報清單</a>
    </header>
    @if (publication) {
      <main class="publication">
        <p class="publication-meta">
          版本 {{ publication.version }} · 發布於
          {{ publication.publishedAt | date: "short" }}
        </p>
        <section class="publication-sources">
          <h2>來源狀態</h2>
          <ul>
            @for (source of publication.sourceStatus || []; track source) {
              <li>
                <strong>{{ source.section }}</strong> ·
                {{ sourceLabel(source.status) }}
                @if (source.periodFrom) {
                  <span> · {{ source.periodFrom }}–{{ source.periodTo }}</span>
                }
              </li>
            }
          </ul>
        </section>
        @for (section of publication.sections; track section) {
          <section>
            <h2>{{ label(section) }}</h2>
            @for (item of inSection(section); track item) {
              <article>
                <h3>{{ item.title }}</h3>
                @if (item.section !== "personnel") {
                  <p>{{ item.content }}</p>
                }
                @if (item.section === "personnel") {
                  <p>
                    生效日期：{{ detailsOf(item.details).effectiveDate }} ·
                    交接：{{ detailsOf(item.details).handover }} · 影響：{{
                      detailsOf(item.details).impact
                    }}
                    · 下一步：{{ detailsOf(item.details).nextStep }}
                  </p>
                }
                @if (detailsOf(item.details).previousCommitment) {
                  <p>
                    上週承諾：{{ detailsOf(item.details).previousCommitment }}
                  </p>
                }
                @if (detailsOf(item.details).sourceLinks?.length) {
                  <ul>
                    @for (
                      source of detailsOf(item.details).sourceLinks;
                      track source
                    ) {
                      <li>
                        <a [href]="source.url" rel="noopener noreferrer">{{
                          source.label
                        }}</a>
                      </li>
                    }
                  </ul>
                }
                @if (detailsOf(item.details).pendingDecision; as decision) {
                  <p>
                    待決策：{{ decision.description }} · 結果：{{
                      decision.result || "待定"
                    }}
                    · 新期限：{{ decision.newDueDate || "待定" }}
                  </p>
                }
                @if (item.schedule?.length) {
                  <div class="gantt">
                    <p><strong>專案甘特圖</strong>（基準／預估／實際）</p>
                    @for (entry of publicationPhases(item.schedule || []); track entry.id) {
                      <div class="gantt-row">
                        <span>{{ entry.name }}@if (entry.warnings?.length) { <small class="gantt-warn-icon" [title]="entry.warnings![0].message">⚠️</small> }</span>
                        <div class="gantt-track">
                          @if (entry.kind === 'milestone') {
                            <i
                              class="milestone-marker"
                              [attr.data-state]="entry.state"
                              [style.left.%]="
                                publicationPosition(
                                  item.schedule || [],
                                  entry.state === 'achieved'
                                    ? entry.actualDate
                                    : entry.forecastDate
                                )
                              "
                            ></i>
                          } @else {
                            <i
                              class="baseline"
                              [style.left.%]="
                                publicationPosition(
                                  item.schedule || [],
                                  entry.baselineStart
                                )
                              "
                              [style.width.%]="
                                publicationWidth(
                                  item.schedule || [],
                                  entry.baselineStart,
                                  entry.baselineEnd
                                )
                              "
                            ></i
                            ><i
                              class="forecast"
                              [style.left.%]="
                                publicationPosition(
                                  item.schedule || [],
                                  entry.forecastStart
                                )
                              "
                              [style.width.%]="
                                publicationWidth(
                                  item.schedule || [],
                                  entry.forecastStart,
                                  entry.forecastEnd
                                )
                              "
                            ></i>
                            @if (entry.actualStart || entry.actualEnd) {
                              <i
                                class="actual"
                                [style.left.%]="
                                  publicationPosition(
                                    item.schedule || [],
                                    entry.actualStart || entry.actualEnd
                                  )
                                "
                                [style.width.%]="
                                  publicationWidth(
                                    item.schedule || [],
                                    entry.actualStart || entry.actualEnd,
                                    entry.actualEnd || entry.actualStart
                                  )
                                "
                              ></i>
                            }
                          }
                        </div>
                        <small>{{ entry.kind === 'milestone' ? (entry.state === 'achieved' ? '實際達成' : '最新目標') : '偏差：' + variance(entry) }}</small>
                      </div>
                    }
                  </div>
                }
                @if (item.schedule?.length) {
                  <ul>
                    @for (entry of activePublicationEntries(item.schedule || []); track entry.id) {
                      <li [class.schedule-task]="entry.kind === 'task'" [class.schedule-milestone]="entry.kind === 'milestone'">
                        <strong
                          >{{
                            entry.kind === "phase" ? "階段" : entry.kind === "task" ? "關鍵任務" : "重要里程碑"
                          }}：{{ entry.name }}</strong
                        >
                        @if (entry.kind === 'task') { · 負責 {{ entry.owner }} }
                        @if (entry.kind === 'milestone') {
                          · {{ entry.state === 'achieved' ? '實際達成' : '最新目標' }} {{ (entry.state === 'achieved' ? entry.actualDate : entry.forecastDate) || "—" }}
                          · 原始目標 {{ entry.baselineDate || "—" }}
                          @if (entry.state === 'achieved' && entry.forecastDate) {
                            · 最新目標 {{ entry.forecastDate }}
                          }
                          · 偏差 {{ milestoneVariance(entry) }}
                        } @else {
                          · 基準 {{ entry.baselineStart || "—" }}–{{
                            entry.baselineEnd || "—"
                          }}
                          · 預估 {{ entry.forecastStart || "—" }}–{{
                            entry.forecastEnd || "—"
                          }}
                          · 實際 {{ entry.actualStart || "—" }}–{{
                            entry.actualEnd || "—"
                          }}
                        }
                        @if (entry.predecessors?.length || entry.successors?.length) {
                          <div class="schedule-dependencies">
                            @for (p of entry.predecessors; track p.id) {
                              <span class="dependency-chip predecessor-chip">前置：{{ p.name }}</span>
                            }
                            @for (s of entry.successors; track s.id) {
                              <span class="dependency-chip successor-chip">後續：{{ s.name }}</span>
                            }
                          </div>
                        }
                        @if (entry.warnings?.length) {
                          <div class="schedule-warnings">
                            @for (w of entry.warnings; track w.message) {
                              <div class="schedule-warning-pill" [attr.data-type]="w.type">
                                <span class="warning-icon">{{ w.type === 'active-warning' ? '⚠️' : '⚡' }}</span>
                                <span>{{ w.message }}</span>
                              </div>
                            }
                          </div>
                        }
                      </li>
                    }
                  </ul>
                  @if (cancelledPublicationEntries(item.schedule || []).length) {
                    <details class="publication-cancelled-section">
                      <summary>
                        <strong>已取消項目（{{ cancelledPublicationEntries(item.schedule || []).length }}）</strong>
                        <small>— 追溯被取消之工作與承諾</small>
                      </summary>
                      <ul class="publication-cancelled-list">
                        @for (entry of cancelledPublicationEntries(item.schedule || []); track entry.id) {
                          <li>
                            <del><strong>{{ entry.kind === "phase" ? "階段" : entry.kind === "task" ? "關鍵任務" : "重要里程碑" }}：{{ entry.name }}</strong></del>
                            <span class="schedule-state" data-state="cancelled">已取消</span>
                            @if (entry.kind === 'task' && entry.owner) { <span> · 原負責 {{ entry.owner }}</span> }
                            @if (entry.kind === 'milestone') {
                              <span> · 原始目標 {{ entry.baselineDate || "—" }}</span>
                            } @else {
                              <span> · 原始計畫 {{ entry.baselineStart || "—" }}–{{ entry.baselineEnd || "—" }}</span>
                              @if (entry.actualStart) {
                                <span> · 保留實際開始日 {{ entry.actualStart }}</span>
                              }
                            }
                          </li>
                        }
                      </ul>
                    </details>
                  }
                }
              </article>
            }
          </section>
        }
      </main>
    }`,
})
export class PublicationPage implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private changes = inject(ChangeDetectorRef);
  publication:
    | (Report & {
        version: number;
        publishedAt: string;
        sourceStatus?: SourceStatus[];
      })
    | null = null;
  detailsOf = detailsOf;
  private publicationId = this.route.snapshot.paramMap.get("id")!;
  label(section: string) {
    return labels[section] ?? section;
  }
  publicationPhases(entries: ScheduleEntry[]) {
    return entries.filter(entry => entry.state !== "cancelled" && (entry.kind === "phase" || entry.kind === "milestone"));
  }
  activePublicationEntries(entries: ScheduleEntry[]) {
    return entries.filter(entry => entry.state !== "cancelled");
  }
  cancelledPublicationEntries(entries: ScheduleEntry[]) {
    return entries.filter(entry => entry.state === "cancelled");
  }
  private publicationDates(entries: ScheduleEntry[]) {
    return entries
      .flatMap((entry) => [
        entry.baselineStart,
        entry.baselineEnd,
        entry.forecastStart,
        entry.forecastEnd,
        entry.actualStart,
        entry.actualEnd,
        entry.baselineDate,
        entry.forecastDate,
        entry.actualDate,
      ])
      .filter((date): date is string => !!date)
      .map((date) => new Date(`${date}T00:00:00`).getTime());
  }
  publicationPosition(entries: ScheduleEntry[], date: string | null | undefined) {
    const dates = this.publicationDates(entries);
    if (!date || !dates.length) return 0;
    const min = Math.min(...dates),
      max = Math.max(...dates);
    return max === min
      ? 0
      : Math.max(
          0,
          Math.min(
            100,
            ((new Date(`${date}T00:00:00`).getTime() - min) * 100) /
              (max - min),
          ),
        );
  }
  publicationWidth(
    entries: ScheduleEntry[],
    start: string | null | undefined,
    end: string | null | undefined,
  ) {
    return !start || !end
      ? 2
      : Math.max(
          2,
          this.publicationPosition(entries, end) -
            this.publicationPosition(entries, start),
        );
  }
  milestoneVariance(entry: ScheduleEntry) {
    if (!entry.baselineDate) return "—";
    const date = entry.state === "achieved" ? entry.actualDate : entry.forecastDate;
    if (!date) return "—";
    const days = Math.round((new Date(`${date}T00:00:00`).getTime() - new Date(`${entry.baselineDate}T00:00:00`).getTime()) / 86400000);
    return `${days > 0 ? "+" : ""}${days} 天`;
  }
  variance(entry: ScheduleEntry) {
    if (!entry.baselineEnd || !entry.forecastEnd) return "—";
    return `${Math.round((new Date(`${entry.forecastEnd}T00:00:00`).getTime() - new Date(`${entry.baselineEnd}T00:00:00`).getTime()) / 86400000)} 天`;
  }
  sourceLabel(status: string) {
    return (
      (
        {
          succeeded: "同步成功",
          partial: "部分同步失敗",
          failed: "同步失敗",
          "not-connected": "尚未接入來源",
        } as Record<string, string>
      )[status] ?? status
    );
  }
  inSection(section: string) {
    return (
      this.publication?.items.filter((item) => item.section === section) ?? []
    );
  }
  async ngOnInit() {
    this.publication = await firstValueFrom(
      this.http.get<typeof this.publication>(
        `/api/publications/${this.publicationId}`,
      ),
    );
    this.changes.detectChanges();
  }
}

@Component({
  standalone: true,
  imports: [],
  template: ` <header><h1>正式處會週報</h1></header>
    <main>
      @if (message) {
        <p>{{ message }}</p>
      }
      @if (publicationUrl) {
        <a [href]="publicationUrl">開啟最新正式發布版</a>
      }
    </main>`,
})
export class ReaderEntrance implements OnInit {
  private http = inject(HttpClient);
  private changes = inject(ChangeDetectorRef);
  publicationUrl = "";
  message = "";
  async ngOnInit() {
    try {
      const latest = await firstValueFrom(
        this.http.get<{ id: string }>("/api/publications/latest"),
      );
      this.publicationUrl = `#/publications/${latest.id}`;
    } catch (error: any) {
      this.message =
        error.status === 404 ? "尚無正式發布版" : "無法載入正式發布版。";
    }
    this.changes.detectChanges();
  }
}

@Component({
  standalone: true,
  template: "<main><h1>無權限</h1><p>此帳號無法編輯處會週報。</p></main>",
})
export class Forbidden {}

export const routes: Routes = [
  { path: "", component: Home, canActivate: [entryGuard] },
  { path: "reports/:id", component: ReportEditor, canActivate: [editorGuard] },
  {
    path: "publications/:id",
    component: PublicationPage,
    canActivate: [readerGuard],
  },
  { path: "reader", component: ReaderEntrance, canActivate: [readerGuard] },
  { path: "forbidden", component: Forbidden },
  { path: "**", redirectTo: "" },
];
