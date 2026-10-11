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
import { Gantt } from "./gantt";
import { WeekEditor } from "./week-editor";
import { latestPublication, PublicationPage as WeekPublication } from "./publication-page";
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
  externalDependencies?: ExternalDependency[];
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
type ProjectProposal = {
  id: string;
  projectId: string;
  scheduleEntryId: string;
  scheduleEntryName: string;
  scheduleEntryKind: string;
  scheduleEntryOwner: string | null;
  progressPercent: number | null;
  workDescription: string;
  proposedStart: string | null;
  proposedEnd: string | null;
  proposedDate: string | null;
  proposedState: string | null;
  sourceOrigin: string | null;
  status: "pending" | "accepted" | "rejected";
  createdBy: string;
  createdByName: string;
  createdAt: string;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionReason: string | null;
  currentBaselineStart: string | null;
  currentBaselineEnd: string | null;
  currentForecastStart: string | null;
  currentForecastEnd: string | null;
  currentBaselineDate: string | null;
  currentForecastDate: string | null;
  currentState: string | null;
};
type DependencyRef = { id: string; name: string; kind: string };
type DependencyWarning = { type: string; message: string; predecessorId: string; predecessorName: string };
type ExternalDeliveryNotice = {
  dependencyId: string;
  description: string;
  supplier: string;
  dueDate: string;
  status: string;
  isOverdue: boolean;
  message: string;
};
type ExternalDependencyLinkRef = {
  scheduleEntryId: string;
  scheduleEntryName: string;
  scheduleEntryKind: string;
};
type ExternalDependencyHistoryEntry = {
  actor: string;
  at: string;
  action: string;
  reason: string | null;
  scheduleEntryId: string | null;
  scheduleEntryName: string | null;
};
type ExternalDependency = {
  id: string;
  projectId: string;
  description: string;
  supplier: string;
  dueDate: string;
  status: "pending" | "delivered";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  linkedScheduleEntries: ExternalDependencyLinkRef[];
  history: ExternalDependencyHistoryEntry[];
};
type ScheduleEntry = {
  id: string;
  continuityId?: string;
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
  externalNotices?: ExternalDeliveryNotice[];
  evidenceLinks?: ScheduleEvidenceView[];
};
type ScheduleEvidenceView = {
  id: string;
  scheduleEntryId: string;
  workId: string;
  section: string | null;
  summary: string;
  periodFrom: string | null;
  periodTo: string | null;
  initialPayload: string;
  latestPayload: string;
  sourceChanged: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  reason: string;
};
type EcimEvidenceCandidate = {
  workId: string;
  section: string;
  periodFrom: string | null;
  periodTo: string | null;
  summary: string;
  payload: string;
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
        @if (latest) { <p><a data-latest-publication href="#/publications/{{ latest.week }}/{{ latest.version }}">最新正式版 {{ latest.week }} v{{ latest.version }}</a></p> }
        <h2>週次</h2>
        @if (me?.role === "Guy") { <button data-create-week (click)="createWeek()">建立下週</button> }
        <ul>
          @for (week of weeks; track week) {
            <li><a href="#/weeks/{{ week }}">{{ week }}</a></li>
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
  weeks: string[] = [];
  latest?: { week: string; version: number };
  meetingDate = new Date().toISOString().slice(0, 10);
  message = "";
  async ngOnInit() {
    this.me = await firstValueFrom(this.http.get<User>("/api/me"));
    this.reports = await firstValueFrom(
      this.http.get<typeof this.reports>("/api/reports"),
    );
    this.weeks = await firstValueFrom(this.http.get<string[]>("/api/weeks"));
    this.latest = latestPublication(await firstValueFrom(this.http.get<{ publications: any[] }>("/api/publications")));
    this.changes.detectChanges();
  }
  async createWeek() {
    try {
      await firstValueFrom(this.http.post("/api/weeks", {}));
      this.weeks = await firstValueFrom(this.http.get<string[]>("/api/weeks"));
    } catch {
      this.message = "無法建立下週（可能已存在）。";
    }
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
  imports: [DatePipe, FormsModule, JsonPipe, Gantt],
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
              <section class="project-proposals-section">
                <div class="proposals-header">
                  <div class="proposals-header-text">
                    <div class="proposals-badge-row">
                      <span class="proposals-eyebrow">PARTICIPANT COLLABORATION</span>
                      <span class="proposals-count-badge">{{ proposals.length }} 則提案</span>
                    </div>
                    <h3>參與者進度與時程提案</h3>
                    <p class="proposals-subtitle">
                      有權課長與任務負責人可回報工作進度並提出預計日期調整建議；週報維護人評估後可審核採納或退回。
                    </p>
                  </div>
                  <div class="proposals-actions-bar">
                    @if (canMaintain(item)) {
                      <button type="button" class="btn-assign-participant" (click)="assignParticipant()">
                        指定參與課別
                      </button>
                      <button type="button" class="btn-proxy-proposal" (click)="openProposalForm(true)">
                        📋 代為記錄外部進度
                      </button>
                    }
                    @if (canSubmitProposal(item)) {
                      <button type="button" class="btn-new-proposal" (click)="openProposalForm(false)">
                        + 回報進度與建議時程
                      </button>
                    }
                  </div>
                </div>

                <div class="proposals-role-banner">
                  <div class="role-icon">💡</div>
                  <div class="role-desc">
                    @if (canMaintain(item)) {
                      <span><strong>維護人權限</strong>：您可審核並採納各課長與任務負責人之提案（走安全租約與修訂歷程），或代表無帳號的外部負責人記錄原始來源。</span>
                    } @else if (canSubmitProposal(item)) {
                      <span><strong>協作回報權限</strong>：您可在此提交您所承擔工作之最新進度與建議完成日期，提案不會直接覆蓋正式排程，將送交週報維護人審核。</span>
                    } @else {
                      <span><strong>檢視模式</strong>：您目前為讀取身分，可查看各項工作進度與提案歷程。</span>
                    }
                  </div>
                </div>

                @if (proposals.length === 0) {
                  <div class="proposals-empty-state">
                    <div class="empty-icon">📝</div>
                    <div class="empty-title">目前尚無進度或時程提案</div>
                    <div class="empty-desc">
                      課長或任務負責人可透過「回報進度與建議時程」提出最新進展與建議；無帳號外部負責人亦可由維護人代為記錄。
                    </div>
                  </div>
                } @else {
                  <div class="proposals-grid">
                    @for (prop of proposals; track prop.id) {
                      <div class="proposal-card" [class.proposal-pending]="prop.status === 'pending'" [class.proposal-accepted]="prop.status === 'accepted'" [class.proposal-rejected]="prop.status === 'rejected'">
                        <div class="proposal-card-header">
                          <div class="proposal-task-pill">
                            <span class="task-kind-tag">{{ prop.scheduleEntryKind === 'task' ? '關鍵任務' : '里程碑' }}</span>
                            <strong class="task-name">{{ prop.scheduleEntryName }}</strong>
                            @if (prop.scheduleEntryOwner) {
                              <span class="task-owner-pill">負責人：{{ prop.scheduleEntryOwner }}</span>
                            }
                          </div>
                          <div class="proposal-status-badge">
                            @if (prop.status === 'pending') {
                              <span class="status-badge status-pending">⏳ 待審核</span>
                            } @else if (prop.status === 'accepted') {
                              <span class="status-badge status-accepted">✓ 已採納</span>
                            } @else {
                              <span class="status-badge status-rejected">✕ 已退回</span>
                            }
                          </div>
                        </div>

                        <div class="proposal-card-body">
                          <div class="proposal-progress-block">
                            <div class="progress-label-row">
                              <span class="progress-title">工作進度回報</span>
                              <span class="progress-value">{{ prop.progressPercent ?? 0 }}%</span>
                            </div>
                            <div class="progress-bar-track">
                              <div class="progress-bar-fill" [style.width.%]="prop.progressPercent ?? 0"></div>
                            </div>
                          </div>

                          <div class="proposal-desc-text">
                            {{ prop.workDescription }}
                          </div>

                          @if (prop.proposedStart || prop.proposedEnd) {
                            <div class="proposal-dates-comparison">
                              <div class="dates-col current-dates">
                                <span class="dates-col-label">目前計畫</span>
                                <span class="dates-col-val">{{ prop.currentForecastStart || '-' }} ~ {{ prop.currentForecastEnd || '-' }}</span>
                              </div>
                              <div class="dates-arrow">➔</div>
                              <div class="dates-col proposed-dates">
                                <span class="dates-col-label">建議調整日期</span>
                                <span class="dates-col-val highlight-val">{{ prop.proposedStart || '-' }} ~ {{ prop.proposedEnd || '-' }}</span>
                              </div>
                            </div>
                          }
                        </div>

                        <div class="proposal-card-footer">
                          <div class="proposal-meta">
                            <span class="meta-origin" [title]="prop.sourceOrigin || ''">
                              @if (prop.sourceOrigin) {
                                📋 來源：{{ prop.sourceOrigin }}
                              } @else {
                                👤 提報人：{{ prop.createdByName || prop.createdBy }}
                              }
                            </span>
                            <span class="meta-time">{{ prop.createdAt.slice(0, 16).replace('T', ' ') }}</span>
                          </div>

                          @if (canMaintain(item) && prop.status === 'pending') {
                            <div class="proposal-review-actions">
                              <button type="button" class="btn-reject-proposal" (click)="openRejectProposal(prop)">
                                退回
                              </button>
                              <button type="button" class="btn-accept-proposal" (click)="openAcceptProposal(prop)">
                                採納提案
                              </button>
                            </div>
                          }
                        </div>

                        @if (prop.status !== 'pending' && prop.decisionReason) {
                          <div class="proposal-decision-note" [class.note-accepted]="prop.status === 'accepted'" [class.note-rejected]="prop.status === 'rejected'">
                            <strong>{{ prop.status === 'accepted' ? '採納備註' : '退回理由' }}（{{ prop.decidedByName || prop.decidedBy }}）：</strong>
                            <span>{{ prop.decisionReason }}</span>
                          </div>
                        }
                      </div>
                    }
                  </div>
                }

                @if (isParticipant || projectWork.length) {
                  <details class="legacy-project-work-details">
                    <summary>課別整體工作備註（{{ projectWork.length }} 筆備忘）</summary>
                    <div class="legacy-work-inner">
                      @if (projectWork.length) {
                        <ul class="legacy-work-list">
                          @for (entry of projectWork; track entry) {
                            <li>
                              <strong class="legacy-section-tag">{{ entry.section }}</strong>：{{ entry.work }}
                              @if (entry.scheduleProposal) {
                                <span class="legacy-prop-tag">（建議：{{ entry.scheduleProposal }}）</span>
                              }
                            </li>
                          }
                        </ul>
                      }
                      @if (isParticipant) {
                        <div class="legacy-work-form">
                          <label>我承擔的工作說明
                            <textarea rows="3" [(ngModel)]="myProjectWork" placeholder="填寫課別綜合工作..."></textarea>
                          </label>
                          <label>關聯關鍵任務（選填，同步提交任務進度提案）
                            <select [(ngModel)]="myProjectWorkScheduleEntryId">
                              <option value="">無關聯特定關鍵任務</option>
                              @for (task of candidateTasks(); track task.id) {
                                <option [value]="task.id">{{ task.name }}（{{ task.owner ? '負責人: ' + task.owner : '無指定負責人' }}）</option>
                              }
                            </select>
                          </label>
                          @if (myProjectWorkScheduleEntryId) {
                            <div class="form-row">
                              <label class="form-field form-field-half">工作完成度 (0-100%)
                                <input type="number" min="0" max="100" [(ngModel)]="myProjectWorkProgress" />
                              </label>
                              <label class="form-field form-field-half">建議完成日期
                                <input type="date" [(ngModel)]="myProjectWorkProposedEnd" />
                              </label>
                            </div>
                          }
                          <label>課別總體時程建議
                            <input [(ngModel)]="myScheduleProposal" placeholder="例：整體進度如期" />
                          </label>
                          <button type="button" class="btn-secondary" (click)="saveProjectWork()">更新課別備註與提案</button>
                        </div>
                      }
                    </div>
                  </details>
                }

                @if (showProposalForm) {
                  <div class="proposal-modal-backdrop">
                    <div class="proposal-modal">
                      <div class="modal-header">
                        <h4>{{ isProxyProposal ? '📋 代為記錄外部負責人進度與時程提案' : '📝 回報任務工作進度與建議時程' }}</h4>
                        <button type="button" class="modal-close-btn" (click)="closeProposalForm()">✕</button>
                      </div>
                      <div class="modal-body">
                        @if (isProxyProposal) {
                          <div class="modal-proxy-alert">
                            <strong>代填模式</strong>：無系統帳號之廠商或跨部門負責人，可由專案維護人代為輸入進度並明確註記原始通訊來源。
                          </div>
                        }

                        <label class="form-field">
                          <span class="field-label">對應關鍵任務 <span class="required">*</span></span>
                          <select [ngModel]="proposalDraft.scheduleEntryId" (ngModelChange)="onProposalTaskSelected($event)">
                            <option value="" disabled>請選擇關鍵任務</option>
                            @for (task of candidateTasks(); track task.id) {
                              <option [value]="task.id">
                                {{ task.name }}（{{ task.owner ? '負責人: ' + task.owner : '無指定負責人' }}）
                              </option>
                            }
                          </select>
                        </label>

                        @if (isProxyProposal) {
                          <label class="form-field">
                            <span class="field-label">原始資訊來源標記 <span class="required">*</span></span>
                            <input [(ngModel)]="proposalDraft.sourceOrigin" placeholder="例如：廠商窗口王工程師 Email 週報 / 會議確認" />
                          </label>
                        }

                        <div class="form-row">
                          <label class="form-field form-field-half">
                            <span class="field-label">工作完成度 (0-100%)</span>
                            <input type="number" min="0" max="100" [(ngModel)]="proposalDraft.progressPercent" />
                          </label>
                          <div class="form-field form-field-half progress-preview-box">
                            <span class="field-label">進度預覽</span>
                            <div class="preview-track">
                              <div class="preview-fill" [style.width.%]="proposalDraft.progressPercent || 0"></div>
                            </div>
                            <span class="preview-text">{{ proposalDraft.progressPercent || 0 }}% 完成</span>
                          </div>
                        </div>

                        <label class="form-field">
                          <span class="field-label">工作進度詳細說明 <span class="required">*</span></span>
                          <textarea rows="3" [(ngModel)]="proposalDraft.workDescription" placeholder="說明本期具體完成項目、遇到的問題或預期規劃..."></textarea>
                        </label>

                        <div class="form-row">
                          <label class="form-field form-field-half">
                            <span class="field-label">建議開始日期（選填）</span>
                            <input type="date" [(ngModel)]="proposalDraft.proposedStart" />
                          </label>
                          <label class="form-field form-field-half">
                            <span class="field-label">建議完成日期（選填）</span>
                            <input type="date" [(ngModel)]="proposalDraft.proposedEnd" />
                          </label>
                        </div>
                      </div>
                      <div class="modal-footer">
                        <button type="button" class="btn-ghost" (click)="closeProposalForm()">取消</button>
                        <button type="button" class="btn-primary" (click)="submitProposal()">確認送出提案</button>
                      </div>
                    </div>
                  </div>
                }

                @if (acceptingProposal) {
                  <div class="proposal-modal-backdrop">
                    <div class="proposal-modal">
                      <div class="modal-header">
                        <h4>✓ 採納時程提案並更新專案排程</h4>
                        <button type="button" class="modal-close-btn" (click)="closeAcceptProposal()">✕</button>
                      </div>
                      <div class="modal-body">
                        <div class="modal-summary-box">
                          <div><strong>受影響任務：</strong> {{ acceptingProposal.scheduleEntryName }}</div>
                          <div><strong>提案來源：</strong> {{ acceptingProposal.sourceOrigin || acceptingProposal.createdByName }}</div>
                          @if (acceptingProposal.proposedStart || acceptingProposal.proposedEnd) {
                            <div class="summary-diff-row">
                              <strong>時程異動：</strong>
                              <span>{{ acceptingProposal.currentForecastStart || '-' }} ~ {{ acceptingProposal.currentForecastEnd || '-' }}</span>
                              ➔
                              <span class="highlight-date">{{ acceptingProposal.proposedStart || '-' }} ~ {{ acceptingProposal.proposedEnd || '-' }}</span>
                            </div>
                          }
                        </div>
                        <label class="form-field">
                          <span class="field-label">採納修訂原因（必填，將記入專案版本修訂歷史） <span class="required">*</span></span>
                          <textarea rows="3" [(ngModel)]="proposalAcceptReason" placeholder="例如：經評估外部供貨時程，同意調整排程以確保交付品質..."></textarea>
                        </label>
                      </div>
                      <div class="modal-footer">
                        <button type="button" class="btn-ghost" (click)="closeAcceptProposal()">取消</button>
                        <button type="button" class="btn-success" (click)="confirmAcceptProposal()">確認採納並推進版本</button>
                      </div>
                    </div>
                  </div>
                }

                @if (rejectingProposal) {
                  <div class="proposal-modal-backdrop">
                    <div class="proposal-modal">
                      <div class="modal-header">
                        <h4>✕ 退回時程提案</h4>
                        <button type="button" class="modal-close-btn" (click)="closeRejectProposal()">✕</button>
                      </div>
                      <div class="modal-body">
                        <div class="modal-summary-box">
                          <div><strong>提案任務：</strong> {{ rejectingProposal.scheduleEntryName }}</div>
                          <div><strong>提報人：</strong> {{ rejectingProposal.sourceOrigin || rejectingProposal.createdByName }}</div>
                        </div>
                        <label class="form-field">
                          <span class="field-label">退回原因說明（必填） <span class="required">*</span></span>
                          <textarea rows="3" [(ngModel)]="proposalRejectReason" placeholder="例如：下游關鍵交付節點已確定，請維持原計畫推進..."></textarea>
                        </label>
                      </div>
                      <div class="modal-footer">
                        <button type="button" class="btn-ghost" (click)="closeRejectProposal()">取消</button>
                        <button type="button" class="btn-danger" (click)="confirmRejectProposal()">確認退回提案</button>
                      </div>
                    </div>
                  </div>
                }
              </section>
            }
            @if (item.section === "projects") {
              <section class="project-schedule">
                <div class="schedule-heading"><div><span class="eyebrow">PROJECT DELIVERY</span><h3>交付時程</h3><p>階段呈現整體交付，關鍵任務標明負責人與確認進度。</p></div><span class="schedule-count">{{ scheduleEntries.length }} 個時程項目</span></div>
                @if (scheduleEntries.length) {
                  <app-gantt [entries]="scheduleEntries" [meetingDate]="report.meetingDate" (entrySelected)="editScheduleById($event)" />
                }
                @if (hasContinuedSchedule()) {
                  <div class="schedule-continuation-banner">
                    <span class="continuation-icon">📌</span>
                    <div class="continuation-info">
                      <strong>本專案時程已延續自前週發布版</strong>
                      <p>穩定邏輯身分、內部前置關聯、跨部門外部相依與歷史修訂已完整延續；新週修改與前週發布版完全隔離。</p>
                    </div>
                  </div>
                }
                <ul>
                  @for (entry of scheduleDisplayEntries(); track entry.id) {
                    <li [class.schedule-task]="entry.kind === 'task'" [class.schedule-milestone]="entry.kind === 'milestone'" [class.schedule-phase]="entry.kind === 'phase'">
                      <strong
                        >{{ entry.kind === "phase" ? "階段" : entry.kind === "task" ? "關鍵任務" : "重要里程碑" }}：{{
                          entry.name
                        }}</strong
                      >
                      @if (entry.continuityId) {
                        <span class="continuity-badge" [title]="'跨週穩定身分: ' + entry.continuityId">身分 #{{ entry.continuityId.slice(0, 6) }}</span>
                      }
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
                      @if (entry.externalNotices?.length) {
                        <div class="schedule-external-notices">
                          @for (n of entry.externalNotices; track n.dependencyId) {
                            <div class="external-notice-pill" [class.is-overdue]="n.isOverdue">
                              <span class="external-icon">{{ n.isOverdue ? '⚠️' : '📦' }}</span>
                              <div class="external-notice-content">
                                <span class="external-notice-title">{{ n.isOverdue ? '外部交付逾期提醒' : '外部交付提醒' }}</span>
                                <span class="external-notice-msg">{{ n.message }}</span>
                              </div>
                            </div>
                          }
                        </div>
                      }
                      @if (canMaintain(item)) {
                        <button (click)="editSchedule(entry)">編輯</button>
                      }
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
                              @if (entry.continuityId) {
                                <span class="continuity-badge" [title]="'跨週穩定身分: ' + entry.continuityId">身分 #{{ entry.continuityId.slice(0, 6) }}</span>
                              }
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
                            </div>
                          </li>
                        }
                      </ul>
                    </details>
                  </div>
                }
                @if (canMaintain(item)) {
                  <div class="schedule-form">
                    <div class="schedule-form-header">
                      <div class="header-main">
                        <h4>{{ editingSchedule ? "編輯交付項目" : "新增交付項目" }}</h4>
                        @if (token) {
                          <span class="lease-active-chip" title="目前鎖定編輯中，可連續新增多個時程項目">
                            <span class="chip-dot"></span> 編輯租約有效中 · 可連續新增
                          </span>
                        } @else {
                          <span class="lease-idle-chip">
                            <span class="chip-lock">🔒</span> 檢視中（需租約以新增）
                          </span>
                        }
                      </div>
                      @if (!editingSchedule) {
                        <label class="continuous-toggle" title="開啟後新增一筆時程會自動保留類型與階段，方便連續新增下一筆">
                          <input type="checkbox" [(ngModel)]="continuousAdd" />
                          <span class="toggle-text">⚡ 連續新增模式</span>
                        </label>
                      }
                    </div>

                    @if (lastAddedNotice) {
                      <div class="schedule-added-toast" role="status">
                        <span class="toast-icon">✓</span>
                        <span class="toast-message">{{ lastAddedNotice }}</span>
                        <button type="button" class="toast-close" (click)="lastAddedNotice = ''" aria-label="關閉通知">✕</button>
                      </div>
                    }

                    @if (!editingSchedule) {
                      <div class="schedule-kind-pills">
                        <button type="button" class="kind-pill" [class.active]="scheduleDraft.kind === 'task'" (click)="setScheduleKind('task')">
                          <span class="pill-icon">📋</span> 關鍵任務
                        </button>
                        <button type="button" class="kind-pill" [class.active]="scheduleDraft.kind === 'milestone'" (click)="setScheduleKind('milestone')">
                          <span class="pill-icon">🚩</span> 重要里程碑
                        </button>
                        <button type="button" class="kind-pill" [class.active]="scheduleDraft.kind === 'phase'" (click)="setScheduleKind('phase')">
                          <span class="pill-icon">📁</span> 專案階段
                        </button>
                      </div>
                    }

                    <label
                      >類型
                      <select [(ngModel)]="scheduleDraft.kind" [disabled]="!!editingSchedule" (ngModelChange)="onScheduleKindChange()">
                        <option value="phase">階段</option>
                        <option value="task">關鍵任務</option>
                        <option value="milestone">重要里程碑</option>
                      </select></label
                    >
                    <label
                      >名稱 <input name="scheduleName" [(ngModel)]="scheduleDraft.name" (keydown.enter)="onScheduleEnterKey($event)" placeholder="請輸入交付項目名稱..."
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

                      <div class="dependency-panel external-dependency-panel">
                        <h5>跨部門相依事項（外部交付風險管理）</h5>
                        @if (editingSchedule.externalNotices?.length) {
                          <ul class="dep-list">
                            @for (n of editingSchedule.externalNotices; track n.dependencyId) {
                              <li class="dep-list-item external-dep-list-item" [class.is-overdue]="n.isOverdue">
                                <div>
                                  <span class="external-tag">外部</span>
                                  <strong>{{ n.description }}</strong>
                                  <small class="external-meta">（{{ n.supplier }} · 到期：{{ n.dueDate }} · {{ n.isOverdue ? '⚠️ 已逾期' : '處理中' }}）</small>
                                </div>
                                <button type="button" class="btn-remove-link" (click)="removeExternalLink(n.dependencyId)">解除關聯</button>
                              </li>
                            }
                          </ul>
                        } @else {
                          <p class="dep-empty">目前未關聯外部跨部門相依事項。</p>
                        }
                        @if (editingSchedule.state !== 'cancelled' && unlinkedExternalDependencies(editingSchedule).length) {
                          <div class="dep-add-box">
                            <label>選擇跨部門相依事項
                              <select [(ngModel)]="selectedExternalDepId">
                                <option value="">請選擇跨部門相依事項...</option>
                                @for (ext of unlinkedExternalDependencies(editingSchedule); track ext.id) {
                                  <option [value]="ext.id">{{ ext.description }}（{{ ext.supplier }} · 到期：{{ ext.dueDate }} · {{ ext.status === 'delivered' ? '已交付' : '未交付' }}）</option>
                                }
                              </select>
                            </label>
                            <label>關聯原因
                              <input [(ngModel)]="externalLinkReason" placeholder="請填寫受此外部交付影響之原因" />
                            </label>
                            <button type="button" class="btn-add-link btn-add-external-link" (click)="addExternalLink()" [disabled]="!selectedExternalDepId || !externalLinkReason.trim()">
                              關聯外部相依事項
                            </button>
                          </div>
                        }
                      </div>

                      @if (editingSchedule.kind === 'task') {
                        <div class="dependency-panel ecim-evidence-panel">
                          <div class="evidence-panel-header">
                            <h5>📎 eCIM 工作證據連結（進度佐證）</h5>
                            <span class="evidence-count-badge">{{ editingSchedule.evidenceLinks?.length || 0 }} 筆證據</span>
                          </div>

                          @if (editingSchedule.evidenceLinks?.length) {
                            <ul class="dep-list evidence-list">
                              @for (ev of editingSchedule.evidenceLinks; track ev.id) {
                                <li class="dep-list-item evidence-list-item" [class.source-changed]="ev.sourceChanged">
                                  <div class="evidence-item-main">
                                    <div class="evidence-item-header">
                                      <span class="evidence-work-id" [title]="'跨週穩定工作身分: ' + ev.workId">🔗 {{ ev.workId }}</span>
                                      @if (ev.section) {
                                        <span class="evidence-sec-tag">課別: {{ ev.section }}</span>
                                      }
                                      @if (ev.periodFrom || ev.periodTo) {
                                        <span class="evidence-period-tag">週期: {{ ev.periodFrom || '—' }} ~ {{ ev.periodTo || '—' }}</span>
                                      }
                                      @if (ev.sourceChanged) {
                                        <span class="evidence-changed-badge" title="eCIM 來源在引用後已有更新，可比對先前引用內容與最新內容">⚠️ eCIM 來源已更新</span>
                                      } @else {
                                        <span class="evidence-synced-badge">✓ 內容一致</span>
                                      }
                                    </div>
                                    <div class="evidence-summary-text"><strong>{{ ev.summary }}</strong></div>
                                    <div class="evidence-reason-text">引用佐證原因：{{ ev.reason }}</div>

                                    @if (ev.sourceChanged) {
                                      <div class="evidence-diff-panel">
                                        <div class="evidence-diff-header">
                                          <span>來源異動比對</span>
                                          <button type="button" class="btn-diff-toggle" (click)="toggleEvidenceDiff(ev.id)">
                                            {{ isEvidenceDiffOpen(ev.id) ? '收合比對' : '展開比對' }}
                                          </button>
                                        </div>
                                        @if (isEvidenceDiffOpen(ev.id)) {
                                          <div class="evidence-diff-body">
                                            <div class="diff-block diff-initial">
                                              <div class="diff-label">引用時保存內容（可追溯）：</div>
                                              <pre class="diff-payload">{{ ev.initialPayload }}</pre>
                                            </div>
                                            <div class="diff-block diff-latest">
                                              <div class="diff-label">eCIM 最新同步內容：</div>
                                              <pre class="diff-payload">{{ ev.latestPayload }}</pre>
                                            </div>
                                          </div>
                                        }
                                      </div>
                                    }
                                  </div>

                                  @if (unlinkingEvidenceId === ev.id) {
                                    <div class="evidence-unlink-confirm-box">
                                      <input [(ngModel)]="unlinkEvidenceReason" placeholder="請填寫移除此證據連結之原因..." />
                                      <div class="evidence-unlink-actions">
                                        <button type="button" class="btn-unlink-confirm" (click)="confirmUnlinkEvidence(ev.id)" [disabled]="!unlinkEvidenceReason.trim()">確認移除</button>
                                        <button type="button" class="btn-unlink-cancel" (click)="cancelUnlinkEvidence()">取消</button>
                                      </div>
                                    </div>
                                  } @else {
                                    <button type="button" class="btn-remove-link btn-remove-evidence" (click)="startUnlinkEvidence(ev.id)" title="移除此項 eCIM 證據連結">移除證據</button>
                                  }
                                </li>
                              }
                            </ul>
                          } @else {
                            <p class="dep-empty">目前未連結任何 eCIM 工作證據（維護人可挑選課別工程師工作以佐證此任務之進展）。</p>
                          }

                          @if (editingSchedule.state !== 'cancelled') {
                            <div class="dep-add-box evidence-add-box">
                              <h6>新增 eCIM 工作證據連結</h6>
                              <div class="evidence-source-picker">
                                <label>挑選本週報已同步之 eCIM 工作
                                  <select [ngModel]="selectedEcimCandidateWorkId" (ngModelChange)="onEcimCandidateSelected($event)">
                                    <option value="">-- 手動輸入工作編號 或 選擇下列 eCIM 來源 --</option>
                                    @for (c of reportEcimCandidateSources; track c.workId) {
                                      <option [value]="c.workId">[{{ c.section }}] {{ c.workId }} · {{ c.summary }} ({{ c.periodFrom }}~{{ c.periodTo }})</option>
                                    }
                                  </select>
                                </label>
                              </div>
                              <div class="form-row">
                                <label class="form-field form-field-half">eCIM 工作代號 <span class="required">*</span>
                                  <input [(ngModel)]="evidenceDraft.workId" placeholder="例如：ecim-ok-work-1" required />
                                </label>
                                <label class="form-field form-field-half">課別
                                  <input [(ngModel)]="evidenceDraft.section" placeholder="例如：s1" />
                                </label>
                              </div>
                              <label>工作摘要／標題
                                <input [(ngModel)]="evidenceDraft.summary" placeholder="佐證工作摘要或說明" />
                              </label>
                              <label>引用佐證原因 <span class="required">*</span>
                                <input [(ngModel)]="evidenceDraft.reason" placeholder="請說明為何此 eCIM 工作作為此關鍵任務之進度佐證" required />
                              </label>
                              <button type="button" class="btn-add-link btn-add-evidence-link" (click)="addEvidenceLink()" [disabled]="!evidenceDraft.workId.trim() || !evidenceDraft.reason.trim()">
                                ＋ 確認連結 eCIM 證據
                              </button>
                            </div>
                          }
                        </div>
                      }
                    }
                    @if (scheduleSaveDisabledReason(); as reason) {
                      <div class="schedule-disabled-hint">
                        <span class="hint-icon">💡</span>
                        <span class="hint-text">{{ reason }}</span>
                        @if (!token) {
                          <button type="button" class="btn-inline-acquire" (click)="acquire()">點此取得租約</button>
                        } @else if (selected.version === 0) {
                          <button type="button" class="btn-inline-acquire" (click)="commitAndContinue()">儲存專案初版並繼續</button>
                        }
                      </div>
                    }
                    <div class="schedule-form-actions">
                      <button (click)="saveSchedule()" [disabled]="!!scheduleSaveDisabledReason()" [title]="scheduleSaveDisabledReason() || ''">
                        {{ editingSchedule ? "儲存時程" : "新增時程" }}
                      </button>
                      @if (!editingSchedule && token) {
                        <button type="button" class="btn-finish-editing" (click)="finishScheduleEditing()" title="提交並釋放編輯租約，完成此專案所有時程的新增與維護">
                          ✓ 結束排程維護（釋放租約）
                        </button>
                      }
                      @if (editingSchedule) {
                        <button (click)="resetScheduleDraft()">取消</button>
                      } @else {
                        <button type="button" class="schedule-secondary" (click)="resetScheduleDraft()">捨棄未提交草稿</button>
                      }
                    </div>
                  </div>
                }
              </section>

              <section class="external-dependencies-section">
                <div class="ext-heading">
                  <div>
                    <h4>跨部門相依事項（外部交付管理）</h4>
                    <p>管理由其他處或外部單位承諾之交付事項；可連結至本專案時程項目，不干擾內部前置順序。</p>
                  </div>
                  <div style="display: flex; align-items: center; gap: .6rem;">
                    <span class="ext-count-badge">{{ externalDependencies.length }} 項外部相依</span>
                    @if (canMaintain(item)) {
                      <button type="button" class="btn-toggle-ext-form" (click)="toggleAddExternalDepForm()">
                        {{ showAddExternalDepForm ? '取消新增' : '＋ 新增外部相依事項' }}
                      </button>
                    }
                  </div>
                </div>

                @if (showAddExternalDepForm) {
                  <div class="schedule-form" style="margin-bottom: 1rem;">
                    <h4>新增跨部門相依事項</h4>
                    @if (selected.version === 0) {
                      <div class="schedule-disabled-hint">
                        <span class="hint-icon">💡</span>
                        <span class="hint-text">專案尚未完成初次儲存，請先儲存專案以建立正式版本，才能新增外部相依事項。</span>
                        @if (token) {
                          <button type="button" class="btn-inline-acquire" (click)="commitAndContinue()">儲存專案初版並繼續</button>
                        }
                      </div>
                    }
                    <label>承諾交付事項描述
                      <input [(ngModel)]="externalDepDraft.description" placeholder="例如：機房伺服器配電施工" required />
                    </label>
                    <label>供應人或單位
                      <input [(ngModel)]="externalDepDraft.supplier" placeholder="例如：廠務處 / 資安處" required />
                    </label>
                    <label>承諾到期日
                      <input type="date" [(ngModel)]="externalDepDraft.dueDate" required />
                    </label>
                    <label>初始狀態
                      <select [(ngModel)]="externalDepDraft.status">
                        <option value="pending">處理中 / 未交付</option>
                        <option value="delivered">已交付</option>
                      </select>
                    </label>
                    <label>建立原因 / 備註
                      <input [(ngModel)]="externalDepDraft.reason" placeholder="例如：新系統上線基礎建設依賴" />
                    </label>
                    <div style="margin-top: .6rem;">
                      <button type="button" (click)="saveExternalDependency()" [disabled]="!token || selected.version === 0 || !externalDepDraft.description.trim() || !externalDepDraft.supplier.trim() || !externalDepDraft.dueDate">儲存外部相依事項</button>
                      <button type="button" class="schedule-secondary" (click)="toggleAddExternalDepForm()">取消</button>
                    </div>
                  </div>
                }

                @if (externalDependencies.length) {
                  <div class="external-deps-grid">
                    @for (dep of externalDependencies; track dep.id) {
                      <div class="external-dep-card" [class.is-delivered]="dep.status === 'delivered'">
                        <div class="ext-card-header">
                          <span class="ext-card-desc">{{ dep.description }}</span>
                          <span class="ext-status-pill" [class.status-delivered]="dep.status === 'delivered'" [class.status-overdue]="dep.status !== 'delivered' && isDepOverdue(dep)" [class.status-pending]="dep.status === 'pending' && !isDepOverdue(dep)">
                            {{ dep.status === 'delivered' ? '已交付 ✓' : isDepOverdue(dep) ? '已逾期 ⚠️' : '處理中' }}
                          </span>
                        </div>
                        <div class="ext-card-meta">
                          <span class="ext-meta-item">🏢 {{ dep.supplier }}</span>
                          <span class="ext-meta-item" [class.ext-overdue-tag]="isDepOverdue(dep) && dep.status !== 'delivered'">
                            📅 到期：{{ dep.dueDate }} {{ isDepOverdue(dep) && dep.status !== 'delivered' ? '（已逾期）' : '' }}
                          </span>
                        </div>
                        <div class="ext-card-links">
                          <span class="ext-links-label">受影響時程項目（{{ dep.linkedScheduleEntries.length }}）：</span>
                          @if (dep.linkedScheduleEntries.length) {
                            <div class="ext-linked-chips">
                              @for (l of dep.linkedScheduleEntries; track l.scheduleEntryId) {
                                <span class="ext-linked-chip">
                                  [{{ l.scheduleEntryKind === 'phase' ? '階段' : l.scheduleEntryKind === 'task' ? '任務' : '里程碑' }}] {{ l.scheduleEntryName }}
                                </span>
                              }
                            </div>
                          } @else {
                            <span class="ext-empty-links">尚未關聯到任何時程項目</span>
                          }
                        </div>
                        @if (canMaintain(item)) {
                          <div class="ext-card-actions">
                            <button type="button" class="btn-ext-status" [class.btn-reopen-delivered]="dep.status === 'delivered'" [class.btn-mark-delivered]="dep.status !== 'delivered'" (click)="toggleExternalDepStatus(dep)">
                              {{ dep.status === 'delivered' ? '重開為處理中' : '標記為已交付 ✓' }}
                            </button>
                            <small style="color: #64748b;">建立於 {{ dep.createdAt | date: "short" }}</small>
                          </div>
                        }
                      </div>
                    }
                  </div>
                } @else {
                  <p style="color: #6b21a8; font-size: .88rem; font-style: italic; margin: .5rem 0;">目前無跨部門相依管理紀錄。</p>
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
  myProjectWorkScheduleEntryId = "";
  myProjectWorkProgress: number | null = null;
  myProjectWorkProposedEnd = "";
  isParticipant = false;
  scheduleEntries: ScheduleEntry[] = [];
  editingSchedule: ScheduleEntry | null = null;
  scheduleDraft = this.emptyScheduleDraft();
  continuousAdd = true;
  lastAddedNotice = "";
  lastAddedTimer: any = null;
  selectedPredecessorId = "";
  linkReason = "";
  externalDependencies: ExternalDependency[] = [];
  showAddExternalDepForm = false;
  externalDepDraft = {
    description: "",
    supplier: "",
    dueDate: "",
    status: "pending" as "pending" | "delivered",
    reason: "",
  };
  selectedExternalDepId = "";
  externalLinkReason = "";
  ecimMembers: EcimMember[] = [];
  ecimCandidates: EcimCandidate[] = [];
  reportEcimCandidateSources: EcimEvidenceCandidate[] = [];
  selectedEcimCandidateWorkId = "";
  evidenceDraft = {
    workId: "",
    section: "",
    summary: "",
    reason: "",
  };
  unlinkingEvidenceId = "";
  unlinkEvidenceReason = "";
  expandedEvidenceDiffs: Set<string> = new Set();
  ecimMessage = "";
  takeoverReason = "";
  publicationUrl = "";
  proposals: ProjectProposal[] = [];
  showProposalForm = false;
  isProxyProposal = false;
  proposalDraft = {
    scheduleEntryId: "",
    progressPercent: 0,
    workDescription: "",
    proposedStart: "",
    proposedEnd: "",
    sourceOrigin: "",
  };
  acceptingProposal: ProjectProposal | null = null;
  proposalAcceptReason = "";
  rejectingProposal: ProjectProposal | null = null;
  proposalRejectReason = "";
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
    this.myProjectWorkScheduleEntryId = "";
    this.myProjectWorkProgress = null;
    this.myProjectWorkProposedEnd = "";
    this.isParticipant = false;
    this.scheduleEntries = [];
    this.resetScheduleDraft();
    if (item.section === "projects") {
      await this.loadProjectWork();
      await this.loadSchedule();
      await this.loadExternalDependencies();
      await this.loadProposals();
    }
    this.changes.detectChanges();
  }
  isEntryOwner(e: ScheduleEntry): boolean {
    if (!this.me || !e.owner) return false;
    const emp = this.me.empNo.toLowerCase();
    const name = this.me.name.toLowerCase();
    const owner = e.owner.trim().toLowerCase();
    if (owner === emp || owner === name) return true;
    const tokens = owner.split(/[\s,/\t;、()[\]（）]+/);
    return tokens.some((t) => t === emp || t === name);
  }
  isTaskOwner(): boolean {
    return this.scheduleEntries.some((e) => this.isEntryOwner(e));
  }
  canSubmitProposal(item: Item): boolean {
    if (this.me?.role === "Reader") return false;
    return this.canMaintain(item) || this.isParticipant || this.isTaskOwner();
  }
  candidateTasks(): ScheduleEntry[] {
    if (!this.selected) return [];
    const tasks = this.scheduleEntries.filter((e) => e.kind === "task");
    if (this.canMaintain(this.selected) || this.isParticipant) {
      return tasks;
    }
    return tasks.filter((e) => this.isEntryOwner(e));
  }
  async loadProposals() {
    if (!this.selected) return;
    try {
      this.proposals = await firstValueFrom(
        this.http.get<ProjectProposal[]>(`/api/items/${this.selected.id}/proposals`),
      );
    } catch {
      this.proposals = [];
    }
    this.changes.detectChanges();
  }
  openProposalForm(isProxy: boolean = false, defaultEntryId?: string) {
    this.isProxyProposal = isProxy;
    this.showProposalForm = true;
    const tasks = this.candidateTasks();
    const candidate = defaultEntryId || (tasks.length > 0 ? tasks[0].id : "");
    const entry = this.scheduleEntries.find((e) => e.id === candidate);
    this.proposalDraft = {
      scheduleEntryId: candidate,
      progressPercent: 0,
      workDescription: "",
      proposedStart: entry?.forecastStart || "",
      proposedEnd: entry?.forecastEnd || "",
      sourceOrigin: isProxy ? (entry?.owner ? `代填（${entry.owner}）` : "維護人代填（無帳號外部負責人）") : "",
    };
    this.changes.detectChanges();
  }
  onProposalTaskSelected(entryId: string) {
    this.proposalDraft.scheduleEntryId = entryId;
    const entry = this.scheduleEntries.find((e) => e.id === entryId);
    if (entry) {
      this.proposalDraft.proposedStart = entry.forecastStart || "";
      this.proposalDraft.proposedEnd = entry.forecastEnd || "";
      if (this.isProxyProposal) {
        this.proposalDraft.sourceOrigin = entry.owner ? `代填（${entry.owner}）` : "維護人代填（無帳號外部負責人）";
      }
    }
  }
  closeProposalForm() {
    this.showProposalForm = false;
    this.changes.detectChanges();
  }
  async submitProposal() {
    if (!this.selected) return;
    if (this.isProxyProposal && !this.proposalDraft.sourceOrigin.trim()) {
      this.message = "代填模式請填寫原始資訊來源標記。";
      return;
    }
    if (!this.proposalDraft.scheduleEntryId) {
      this.message = "請選擇對應關鍵任務。";
      return;
    }
    if (!this.proposalDraft.workDescription.trim()) {
      this.message = "請填寫工作進度說明。";
      return;
    }
    try {
      await firstValueFrom(
        this.http.post(`/api/items/${this.selected.id}/proposals`, {
          scheduleEntryId: this.proposalDraft.scheduleEntryId,
          workDescription: this.proposalDraft.workDescription.trim(),
          progressPercent: Number(this.proposalDraft.progressPercent) || 0,
          proposedStart: this.proposalDraft.proposedStart || null,
          proposedEnd: this.proposalDraft.proposedEnd || null,
          sourceOrigin: this.proposalDraft.sourceOrigin.trim() || null,
        }),
      );
      this.showProposalForm = false;
      this.message = "已送出工作進度與時程提案。";
      await this.loadProposals();
    } catch (error: any) {
      this.message = error?.error?.error || "送出提案失敗。";
    }
    this.changes.detectChanges();
  }
  openAcceptProposal(p: ProjectProposal) {
    this.acceptingProposal = p;
    this.proposalAcceptReason = `採納時程提案：調整預計時程至 ${p.proposedStart || ""} ~ ${p.proposedEnd || ""}`;
    this.changes.detectChanges();
  }
  closeAcceptProposal() {
    this.acceptingProposal = null;
    this.proposalAcceptReason = "";
    this.changes.detectChanges();
  }
  async confirmAcceptProposal() {
    if (!this.selected || !this.acceptingProposal) return;
    if (!this.proposalAcceptReason.trim()) {
      this.message = "請填寫採納修訂原因。";
      return;
    }
    try {
      if (!this.token) {
        await this.acquire();
      }
      const targetEntry = this.scheduleEntries.find((e) => e.id === this.acceptingProposal!.scheduleEntryId);
      const result = (await firstValueFrom(
        this.http.post(`/api/items/${this.selected.id}/proposals/${this.acceptingProposal.id}/accept`, {
          reason: this.proposalAcceptReason.trim(),
          token: this.token,
          baseProjectVersion: this.baseVersion || this.selected.version,
          baseEntryVersion: targetEntry ? targetEntry.version : undefined,
        }),
      )) as { projectVersion: number };
      this.baseVersion = result.projectVersion;
      if (this.selected) this.selected.version = result.projectVersion;
      this.acceptingProposal = null;
      this.proposalAcceptReason = "";
      this.message = "已採納提案並更新關鍵任務時程。";
      await this.loadSchedule();
      await this.loadProposals();
    } catch (error: any) {
      if (error?.status === 409 && error.error) {
        this.conflict = error.error;
      }
      this.message = error?.error?.error || "採納提案失敗。";
    }
    this.changes.detectChanges();
  }
  openRejectProposal(p: ProjectProposal) {
    this.rejectingProposal = p;
    this.proposalRejectReason = "維持專案原定時程承諾，不作調整";
    this.changes.detectChanges();
  }
  closeRejectProposal() {
    this.rejectingProposal = null;
    this.proposalRejectReason = "";
    this.changes.detectChanges();
  }
  async confirmRejectProposal() {
    if (!this.selected || !this.rejectingProposal) return;
    if (!this.proposalRejectReason.trim()) {
      this.message = "請填寫退回原因。";
      return;
    }
    try {
      await firstValueFrom(
        this.http.post(`/api/items/${this.selected.id}/proposals/${this.rejectingProposal.id}/reject`, {
          reason: this.proposalRejectReason.trim(),
        }),
      );
      this.rejectingProposal = null;
      this.proposalRejectReason = "";
      this.message = "已退回該項提案。";
      await this.loadProposals();
    } catch (error: any) {
      this.message = error?.error?.error || "退回提案失敗。";
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
          scheduleEntryId: this.myProjectWorkScheduleEntryId || null,
          progressPercent: this.myProjectWorkProgress !== null && this.myProjectWorkProgress !== undefined && this.myProjectWorkProgress !== ("" as any) ? Number(this.myProjectWorkProgress) : null,
          proposedEnd: this.myProjectWorkProposedEnd || null,
        }),
      );
      await this.loadProjectWork();
      await this.loadProposals();
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
  hasContinuedSchedule(): boolean {
    return this.scheduleEntries.some(e => !!e.continuityId && e.continuityId !== e.id);
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
  setScheduleKind(kind: ScheduleEntry["kind"]) {
    if (this.editingSchedule) return;
    this.scheduleDraft.kind = kind;
    this.onScheduleKindChange();
  }
  onScheduleEnterKey(event: Event) {
    if (this.scheduleSaveDisabledReason()) return;
    event.preventDefault();
    this.saveSchedule();
  }
  async finishScheduleEditing() {
    if (this.scheduleDraft.name.trim()) {
      if (!confirm("尚有未提交的交付項目草稿，確定要結束編輯並釋放租約嗎？")) return;
    }
    await this.commit();
  }
  async commitAndContinue() {
    if (!this.selected) return;
    await this.commit();
    if (this.selected && this.selected.version > 0) {
      await this.acquire();
      this.message = "專案初版已提交，編輯租約已就緒，可開始新增交付項目與時程。";
      this.changes.detectChanges();
    }
  }
  scheduleSaveDisabledReason(): string | null {
    if (!this.token) {
      return "尚未取得編輯租約，請點擊上方「開始編輯」鎖定編輯權限。";
    }
    if (this.selected?.version === 0) {
      return "專案尚未完成初次儲存，請先儲存專案以建立正式版本，才能新增交付項目與時程。";
    }
    if (!this.scheduleDraft.name.trim()) {
      return "請填寫交付項目「名稱」。";
    }
    if (this.scheduleDraft.kind === "task" && !this.scheduleDraft.owner.trim()) {
      return "關鍵任務必須填寫「負責人或單位」。";
    }
    if (this.scheduleDraft.kind === "milestone" && !this.editingSchedule && !this.scheduleDraft.targetDate) {
      return "重要里程碑必須填寫「目標日期」。";
    }
    if (this.scheduleDraft.kind === "phase" || this.scheduleDraft.kind === "task") {
      if (!this.scheduleDraft.baselineStart) {
        return "請填寫「原始計畫開始」日期。";
      }
      if (!this.scheduleDraft.baselineEnd) {
        return "請填寫「原始計畫結束」日期。";
      }
      if (this.scheduleDraft.baselineStart > this.scheduleDraft.baselineEnd) {
        return "原始計畫開始日期不可晚於結束日期。";
      }
      if (this.editingSchedule) {
        if (this.scheduleDraft.forecastStart && this.scheduleDraft.forecastEnd && this.scheduleDraft.forecastStart > this.scheduleDraft.forecastEnd) {
          return "目前計畫開始日期不可晚於結束日期。";
        }
        if (this.scheduleDraft.actualStart && this.scheduleDraft.actualEnd && this.scheduleDraft.actualStart > this.scheduleDraft.actualEnd) {
          return "實際開始日期不可晚於結束日期。";
        }
      }
    }
    if (this.editingSchedule) {
      if (!this.scheduleDraft.reason.trim()) {
        return "修訂項目必須填寫「修改原因」。";
      }
      if (this.scheduleDraft.kind === "milestone" && this.scheduleDraft.state === "achieved" && !this.scheduleDraft.actualDate) {
        return "標記里程碑為已達成時，必須填寫「實際達成日」。";
      }
      if (
        this.editingSchedule.kind === "phase" &&
        this.editingSchedule.state !== "completed" &&
        this.scheduleDraft.state === "completed" &&
        this.editingSchedule.unfinishedTasks?.length &&
        !this.scheduleDraft.acknowledgeIncompleteTasks
      ) {
        return "尚有未完成任務，請勾選檢視未完成任務之聲明。";
      }
      if (this.scheduleDraft.action === "cancel" && !!this.cancellationBlockerMessage(this.editingSchedule)) {
        return this.cancellationBlockerMessage(this.editingSchedule);
      }
    }
    return null;
  }
  cancelledScheduleEntries() {
    return this.scheduleEntries.filter(entry => entry.state === "cancelled");
  }
  editScheduleById(id: string) {
    const entry = this.scheduleEntries.find((e) => e.id === id);
    if (entry) this.editSchedule(entry);
  }
  editSchedule(entry: ScheduleEntry) {
    this.editingSchedule = entry;
    this.selectedPredecessorId = "";
    this.linkReason = "";
    this.selectedExternalDepId = "";
    this.externalLinkReason = "";
    this.selectedEcimCandidateWorkId = "";
    this.evidenceDraft = { workId: "", section: "", summary: "", reason: "" };
    this.unlinkingEvidenceId = "";
    this.unlinkEvidenceReason = "";
    if (entry.kind === "task") {
      this.loadEcimCandidateSources();
    }
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
  resetScheduleDraft() {
    this.editingSchedule = null;
    this.scheduleDraft = this.emptyScheduleDraft();
    this.selectedPredecessorId = "";
    this.linkReason = "";
    this.selectedExternalDepId = "";
    this.externalLinkReason = "";
    this.selectedEcimCandidateWorkId = "";
    this.evidenceDraft = { workId: "", section: "", summary: "", reason: "" };
    this.unlinkingEvidenceId = "";
    this.unlinkEvidenceReason = "";
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
  async loadExternalDependencies() {
    if (!this.selected) return;
    try {
      this.externalDependencies = await firstValueFrom(
        this.http.get<ExternalDependency[]>(
          `/api/items/${this.selected.id}/external-dependencies`,
        ),
      );
    } catch {
      this.externalDependencies = [];
    }
    this.changes.detectChanges();
  }
  toggleAddExternalDepForm() {
    this.showAddExternalDepForm = !this.showAddExternalDepForm;
    this.changes.detectChanges();
  }
  isDepOverdue(dep: ExternalDependency): boolean {
    if (dep.status === "delivered") return false;
    const today = new Date().toISOString().slice(0, 10);
    return dep.dueDate < today;
  }
  async saveExternalDependency() {
    if (!this.selected || this.selected.version === 0 || !this.externalDepDraft.description.trim() || !this.externalDepDraft.supplier.trim() || !this.externalDepDraft.dueDate) {
      if (this.selected?.version === 0) {
        this.message = "專案尚未完成初次儲存，請先儲存專案以建立正式版本。";
        this.changes.detectChanges();
      }
      return;
    }
    try {
      const result = (await firstValueFrom(
        this.http.post(`/api/items/${this.selected.id}/external-dependencies`, {
          description: this.externalDepDraft.description.trim(),
          supplier: this.externalDepDraft.supplier.trim(),
          dueDate: this.externalDepDraft.dueDate,
          status: this.externalDepDraft.status,
          reason: this.externalDepDraft.reason.trim() || undefined,
          token: this.token,
          baseProjectVersion: this.baseVersion,
        }),
      )) as { projectVersion: number };
      this.baseVersion = result.projectVersion;
      await this.loadExternalDependencies();
      await this.loadSchedule();
      this.externalDepDraft = { description: "", supplier: "", dueDate: "", status: "pending", reason: "" };
      this.showAddExternalDepForm = false;
      this.message = "已新增跨部門相依事項。";
    } catch (error: any) {
      if (error.status === 409) {
        this.conflict = error.error;
        if (error.error?.latest?.schedule) this.scheduleEntries = error.error.latest.schedule;
      }
      this.message = error.error?.error || "新增跨部門相依事項失敗。";
    }
    this.changes.detectChanges();
  }
  async toggleExternalDepStatus(dep: ExternalDependency) {
    if (!this.selected) return;
    const nextStatus = dep.status === "pending" ? "delivered" : "pending";
    const reason = prompt(`請輸入變更為「${nextStatus === 'delivered' ? '已交付' : '處理中'}」的原因：`, nextStatus === 'delivered' ? '外部單位確認交付完成' : '重新追蹤外部交付');
    if (!reason || !reason.trim()) {
      if (reason !== null) alert("變更狀態必須填寫原因。");
      return;
    }
    try {
      const result = (await firstValueFrom(
        this.http.put(`/api/items/${this.selected.id}/external-dependencies/${dep.id}`, {
          description: dep.description,
          supplier: dep.supplier,
          dueDate: dep.dueDate,
          status: nextStatus,
          reason: reason.trim(),
          token: this.token,
          baseProjectVersion: this.baseVersion,
        }),
      )) as { projectVersion: number };
      this.baseVersion = result.projectVersion;
      await this.loadExternalDependencies();
      await this.loadSchedule();
      this.message = `跨部門相依事項已變更為「${nextStatus === 'delivered' ? '已交付' : '處理中'}」。`;
    } catch (error: any) {
      if (error.status === 409) {
        this.conflict = error.error;
        if (error.error?.latest?.schedule) this.scheduleEntries = error.error.latest.schedule;
      }
      this.message = error.error?.error || "變更狀態失敗。";
    }
    this.changes.detectChanges();
  }
  unlinkedExternalDependencies(entry: ScheduleEntry): ExternalDependency[] {
    const linkedIds = new Set((entry.externalNotices || []).map((n) => n.dependencyId));
    return this.externalDependencies.filter((dep) => !linkedIds.has(dep.id));
  }
  async addExternalLink() {
    if (!this.selected || !this.editingSchedule || !this.selectedExternalDepId || !this.externalLinkReason.trim()) return;
    try {
      const result = (await firstValueFrom(
        this.http.post(`/api/items/${this.selected.id}/external-dependencies/${this.selectedExternalDepId}/links`, {
          scheduleEntryId: this.editingSchedule.id,
          reason: this.externalLinkReason.trim(),
          token: this.token,
          baseProjectVersion: this.baseVersion,
        }),
      )) as { projectVersion: number };
      this.baseVersion = result.projectVersion;
      await this.loadSchedule();
      await this.loadExternalDependencies();
      this.editingSchedule = this.scheduleEntries.find((e) => e.id === this.editingSchedule?.id) ?? null;
      this.selectedExternalDepId = "";
      this.externalLinkReason = "";
      this.message = "已建立跨部門相依關聯。";
    } catch (error: any) {
      if (error.status === 409) {
        this.conflict = error.error;
        if (error.error?.latest?.schedule) this.scheduleEntries = error.error.latest.schedule;
      }
      this.message = error.error?.error || "無法建立跨部門相依關聯。";
    }
    this.changes.detectChanges();
  }
  async removeExternalLink(depId: string) {
    if (!this.selected || !this.editingSchedule) return;
    const reason = prompt("請輸入解除跨部門相依關聯的原因：")?.trim();
    if (!reason) {
      if (reason !== undefined && reason !== null) alert("解除相依關聯必須填寫原因。");
      return;
    }
    try {
      const result = (await firstValueFrom(
        this.http.post(`/api/items/${this.selected.id}/external-dependencies/${depId}/links/delete`, {
          scheduleEntryId: this.editingSchedule.id,
          reason,
          token: this.token,
          baseProjectVersion: this.baseVersion,
        }),
      )) as { projectVersion: number };
      this.baseVersion = result.projectVersion;
      await this.loadSchedule();
      await this.loadExternalDependencies();
      this.editingSchedule = this.scheduleEntries.find((e) => e.id === this.editingSchedule?.id) ?? null;
      this.message = "已解除跨部門相依關聯。";
    } catch (error: any) {
      if (error.status === 409) {
        this.conflict = error.error;
        if (error.error?.latest?.schedule) this.scheduleEntries = error.error.latest.schedule;
      }
      this.message = error.error?.error || "無法解除跨部門相依關聯。";
    }
    this.changes.detectChanges();
  }
  async loadEcimCandidateSources() {
    if (!this.selected) return;
    try {
      this.reportEcimCandidateSources = await firstValueFrom(
        this.http.get<EcimEvidenceCandidate[]>(`/api/reports/${this.reportId}/items/${this.selected.id}/ecim-evidence-sources`),
      );
    } catch {
      this.reportEcimCandidateSources = [];
    }
    this.changes.detectChanges();
  }
  onEcimCandidateSelected(workId: string) {
    this.selectedEcimCandidateWorkId = workId;
    if (!workId) return;
    const candidate = this.reportEcimCandidateSources.find((c) => c.workId === workId);
    if (candidate) {
      this.evidenceDraft.workId = candidate.workId;
      this.evidenceDraft.section = candidate.section || "";
      this.evidenceDraft.summary = candidate.summary || "";
      if (!this.evidenceDraft.reason) {
        this.evidenceDraft.reason = `引用 ${candidate.section || '課別'} 工作 (${candidate.workId}) 作為任務佐證`;
      }
    }
    this.changes.detectChanges();
  }
  async addEvidenceLink() {
    if (!this.selected || !this.editingSchedule || this.editingSchedule.kind !== "task") return;
    if (!this.evidenceDraft.workId.trim() || !this.evidenceDraft.reason.trim()) {
      this.message = "請填寫 eCIM 工作代號與佐證原因。";
      return;
    }
    try {
      const result = (await firstValueFrom(
        this.http.post(`/api/items/${this.selected.id}/schedule-entries/${this.editingSchedule.id}/evidence-links`, {
          workId: this.evidenceDraft.workId.trim(),
          section: this.evidenceDraft.section.trim(),
          summary: this.evidenceDraft.summary.trim(),
          reason: this.evidenceDraft.reason.trim(),
          token: this.token,
          baseProjectVersion: this.baseVersion,
        }),
      )) as { projectVersion: number; link: ScheduleEvidenceView };
      this.baseVersion = result.projectVersion;
      await this.loadSchedule();
      this.editingSchedule = this.scheduleEntries.find((e) => e.id === this.editingSchedule?.id) ?? null;
      this.evidenceDraft = { workId: "", section: "", summary: "", reason: "" };
      this.selectedEcimCandidateWorkId = "";
      this.message = "已成功連結 eCIM 工作證據。";
    } catch (error: any) {
      if (error.status === 409) {
        this.conflict = error.error;
        if (error.error?.latest?.schedule) this.scheduleEntries = error.error.latest.schedule;
      }
      this.message = error.error?.error || "無法連結 eCIM 工作證據。";
    }
    this.changes.detectChanges();
  }
  startUnlinkEvidence(linkId: string) {
    this.unlinkingEvidenceId = linkId;
    this.unlinkEvidenceReason = "解除關聯";
    this.changes.detectChanges();
  }
  cancelUnlinkEvidence() {
    this.unlinkingEvidenceId = "";
    this.unlinkEvidenceReason = "";
    this.changes.detectChanges();
  }
  async confirmUnlinkEvidence(linkId: string) {
    if (!this.selected || !this.editingSchedule) return;
    if (!this.unlinkEvidenceReason.trim()) {
      this.message = "請填寫移除證據之原因。";
      return;
    }
    try {
      const result = (await firstValueFrom(
        this.http.post(`/api/items/${this.selected.id}/schedule-entries/${this.editingSchedule.id}/evidence-links/${linkId}/delete`, {
          reason: this.unlinkEvidenceReason.trim(),
          token: this.token,
          baseProjectVersion: this.baseVersion,
        }),
      )) as { projectVersion: number };
      this.baseVersion = result.projectVersion;
      await this.loadSchedule();
      this.editingSchedule = this.scheduleEntries.find((e) => e.id === this.editingSchedule?.id) ?? null;
      this.unlinkingEvidenceId = "";
      this.unlinkEvidenceReason = "";
      this.message = "已成功移除 eCIM 工作證據。";
    } catch (error: any) {
      if (error.status === 409) {
        this.conflict = error.error;
        if (error.error?.latest?.schedule) this.scheduleEntries = error.error.latest.schedule;
      }
      this.message = error.error?.error || "無法移除 eCIM 工作證據。";
    }
    this.changes.detectChanges();
  }
  toggleEvidenceDiff(linkId: string) {
    if (this.expandedEvidenceDiffs.has(linkId)) {
      this.expandedEvidenceDiffs.delete(linkId);
    } else {
      this.expandedEvidenceDiffs.add(linkId);
    }
    this.changes.detectChanges();
  }
  isEvidenceDiffOpen(linkId: string): boolean {
    return this.expandedEvidenceDiffs.has(linkId);
  }
  async saveSchedule() {
    if (!this.selected) return;
    const disabledReason = this.scheduleSaveDisabledReason();
    if (disabledReason) {
      this.message = disabledReason;
      this.changes.detectChanges();
      return;
    }
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
      if (this.selected) this.selected.version = result.projectVersion;
      await this.loadSchedule();

      const addedName = this.scheduleDraft.name.trim();
      const wasAdding = !this.editingSchedule;
      const prevKind = this.scheduleDraft.kind;
      const prevPhaseId = this.scheduleDraft.phaseId;
      const prevOwner = this.scheduleDraft.owner;

      if (wasAdding && this.continuousAdd) {
        this.resetScheduleDraft();
        this.scheduleDraft.kind = prevKind;
        this.scheduleDraft.phaseId = prevPhaseId;
        this.scheduleDraft.owner = prevOwner;
        this.lastAddedNotice = `已成功新增交付項目「${addedName}」，可繼續輸入下一項。`;
        clearTimeout(this.lastAddedTimer);
        this.lastAddedTimer = setTimeout(() => {
          this.lastAddedNotice = "";
          this.changes.detectChanges();
        }, 6000);
        setTimeout(() => {
          const input = document.querySelector<HTMLInputElement>('.schedule-form input[name="scheduleName"]');
          input?.focus();
        }, 80);
      } else {
        this.resetScheduleDraft();
      }
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
  imports: [DatePipe, Gantt],
  template: ` <header>
      <div class="publication-title-group">
        <h1>
          正式處會週報 <small>{{ publication?.meetingDate }}</small>
        </h1>
        @if (publication) {
          <span class="publication-badge">🔒 正式不可變快照</span>
        }
      </div>
      <div class="publication-actions">
        <button type="button" class="btn-print-pub" (click)="printReport()">🖨️ 列印 / 另存 PDF</button>
        <a href="#/">週報清單</a>
      </div>
    </header>
    @if (publication) {
      <main class="publication">
        <div class="publication-header-bar">
          <p class="publication-meta">
            版本 {{ publication.version }} · 發布於
            {{ publication.publishedAt | date: "short" }}
          </p>
        </div>
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
                  <app-gantt [entries]="item.schedule!" [meetingDate]="publication.meetingDate" />
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
                        @if (entry.continuityId) {
                          <span class="continuity-badge" [title]="'跨週穩定身分: ' + entry.continuityId">身分 #{{ entry.continuityId.slice(0, 6) }}</span>
                        }
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
                                <span class="publication-frozen-badge">發布時凍結</span>
                              </div>
                            }
                          </div>
                        }
                        @if (entry.externalNotices?.length) {
                          <div class="schedule-external-notices">
                            @for (n of entry.externalNotices; track n.dependencyId) {
                              <div class="external-notice-pill" [class.is-overdue]="n.isOverdue">
                                <span class="external-icon">{{ n.isOverdue ? '⚠️' : '📦' }}</span>
                                <div class="external-notice-content">
                                  <span class="external-notice-title">{{ n.isOverdue ? '外部交付逾期提醒（發布快照）' : '外部交付提醒（發布快照）' }}</span>
                                  <span class="external-notice-msg">{{ n.message }}</span>
                                </div>
                              </div>
                            }
                          </div>
                        }
                        @if (entry.evidenceLinks?.length) {
                          <div class="schedule-evidence-section">
                            <div class="evidence-section-header">
                              <span class="evidence-section-title">📎 eCIM 工作佐證（發布快照）</span>
                              <span class="evidence-count-badge">{{ entry.evidenceLinks!.length }} 筆</span>
                            </div>
                            <div class="evidence-pill-grid">
                              @for (ev of entry.evidenceLinks; track ev.id) {
                                <div class="pub-evidence-pill" (click)="openPubEvidenceModal(ev)" [title]="'點擊檢視佐證詳情與引用時快照: ' + ev.workId">
                                  <span class="pub-evidence-id">{{ ev.workId }}</span>
                                  @if (ev.section) {
                                    <span class="pub-evidence-sec">[{{ ev.section }}]</span>
                                  }
                                  <span class="pub-evidence-summary">{{ ev.summary }}</span>
                                  @if (ev.sourceChanged) {
                                    <span class="evidence-changed-badge" title="發布時此工作來源與引用時不同">變動</span>
                                  }
                                </div>
                              }
                            </div>
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
                            @if (entry.continuityId) {
                              <span class="continuity-badge" [title]="'跨週穩定身分: ' + entry.continuityId">身分 #{{ entry.continuityId.slice(0, 6) }}</span>
                            }
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
                            @if (entry.evidenceLinks?.length) {
                              <div class="schedule-evidence-section" style="margin-top: .4rem;">
                                <div class="evidence-pill-grid">
                                  @for (ev of entry.evidenceLinks; track ev.id) {
                                    <div class="pub-evidence-pill" (click)="openPubEvidenceModal(ev)">
                                      <span class="pub-evidence-id">{{ ev.workId }}</span>
                                      <span class="pub-evidence-summary">{{ ev.summary }}</span>
                                    </div>
                                  }
                                </div>
                              </div>
                            }
                          </li>
                        }
                      </ul>
                    </details>
                  }
                }
                @if (item.externalDependencies?.length) {
                  <div class="pub-ext-deps-section">
                    <div class="pub-ext-deps-header">
                      <h4>跨部門相依事項（發布快照）</h4>
                      <small>共 {{ item.externalDependencies!.length }} 項外部承諾</small>
                    </div>
                    <div class="pub-ext-dep-grid">
                      @for (dep of item.externalDependencies; track dep.id) {
                        <div class="pub-ext-dep-card">
                          <div class="pub-ext-dep-top">
                            <span class="pub-ext-dep-desc">{{ dep.description }}</span>
                            <span class="status-badge" [class.status-accepted]="dep.status === 'delivered'" [class.status-pending]="dep.status === 'pending'">
                              {{ dep.status === 'delivered' ? '已交付' : '進行中' }}
                            </span>
                          </div>
                          <div class="pub-ext-dep-meta">
                            <div>供應單位：<strong>{{ dep.supplier }}</strong></div>
                            <div>約定交付日：<strong>{{ dep.dueDate }}</strong></div>
                          </div>
                          @if (dep.linkedScheduleEntries.length) {
                            <div class="pub-ext-dep-links">
                              @for (link of dep.linkedScheduleEntries; track link.scheduleEntryId) {
                                <span class="pub-ext-link-tag">關聯：{{ link.scheduleEntryName }}</span>
                              }
                            </div>
                          }
                        </div>
                      }
                    </div>
                  </div>
                }
              </article>
            }
          </section>
        }

        @if (selectedPubEvidence; as ev) {
          <div class="history-modal-backdrop" (click)="closePubEvidenceModal()">
            <div class="history-modal" (click)="$event.stopPropagation()">
              <div class="history-modal-header">
                <div>
                  <h3 class="history-modal-title">
                    <span>📎 eCIM 工作佐證快照</span>
                    <span class="task-kind-tag">工作編號: {{ ev.workId }}</span>
                  </h3>
                  <p class="history-modal-subtitle">
                    {{ ev.summary }} · 🔒 快照版本 {{ publication.version }}（發布時已固化）
                  </p>
                </div>
                <button type="button" class="modal-close-btn" (click)="closePubEvidenceModal()">✕</button>
              </div>
              <div class="history-modal-body">
                <div class="evidence-modal-meta">
                  <div><strong>所屬課別：</strong>{{ ev.section || '—' }}</div>
                  <div><strong>建立引用時間：</strong>{{ formatDateTime(ev.createdAt) }}</div>
                  @if (ev.reason) {
                    <div><strong>引用佐證原因：</strong>{{ ev.reason }}</div>
                  }
                  @if (ev.periodFrom || ev.periodTo) {
                    <div><strong>工作期間：</strong>{{ ev.periodFrom || '—' }} ~ {{ ev.periodTo || '—' }}</div>
                  }
                </div>
                <div class="diff-block diff-initial" style="margin-top: 1rem;">
                  <div class="diff-label">引用時保存內容（發布快照）：</div>
                  <pre class="diff-payload">{{ ev.initialPayload }}</pre>
                </div>
                @if (ev.latestPayload && ev.latestPayload !== ev.initialPayload) {
                  <div class="diff-block diff-latest" style="margin-top: 1rem;">
                    <div class="diff-label">發布當時 eCIM 最新狀態：</div>
                    <pre class="diff-payload">{{ ev.latestPayload }}</pre>
                  </div>
                }
              </div>
              <div class="history-modal-footer">
                <button type="button" class="btn-ghost" (click)="closePubEvidenceModal()">關閉</button>
              </div>
            </div>
          </div>
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
  selectedPubEvidence: ScheduleEvidenceView | null = null;
  private publicationId = this.route.snapshot.paramMap.get("id")!;

  openPubEvidenceModal(ev: ScheduleEvidenceView) {
    this.selectedPubEvidence = ev;
    this.changes.detectChanges();
  }
  closePubEvidenceModal() {
    this.selectedPubEvidence = null;
    this.changes.detectChanges();
  }
  @HostListener("document:keydown.escape") onEscape() {
    if (this.selectedPubEvidence) this.closePubEvidenceModal();
  }
  printReport() {
    window.print();
  }
  formatDateTime(iso: string) {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleString("zh-TW", { hour12: false });
  }
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
  { path: "weeks/:week", component: WeekEditor, canActivate: [editorGuard] },
  { path: "publications/:week/:version", component: WeekPublication, canActivate: [editorGuard] },
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
