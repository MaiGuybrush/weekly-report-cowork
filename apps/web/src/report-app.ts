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
  version: number;
  state: "open" | "in-progress" | "completed" | "cancelled";
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
                        </div>
                        <small>基準／預估／實際</small>
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
                    <li [class.schedule-task]="entry.kind === 'task'">
                      <strong
                        >{{ entry.kind === "phase" ? "階段" : entry.kind === "task" ? "關鍵任務" : "里程碑" }}：{{
                          entry.name
                        }}</strong
                      >
                      <span class="schedule-state" [attr.data-state]="entry.state">{{ scheduleStateLabel(entry.state) }}</span>
                      @if (entry.kind === 'task') { <span class="schedule-owner">負責 {{ entry.owner }} · {{ phaseName(entry.phaseId) }}</span> }
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
                      @if (canMaintain(item)) {
                        <button (click)="editSchedule(entry)">編輯</button>
                      }
                      <button (click)="loadScheduleHistory(entry)">
                        修訂紀錄
                      </button>
                    </li>
                  }
                </ul>
                @if (baselineHistory.length) {
                  <ul class="schedule-history">
                    @for (change of baselineHistory; track change) {
                      <li>
                        <strong>{{ change.action }}</strong> · {{ change.actor }} · {{ change.at | date: "short" }} · {{ change.reason || "建立" }}
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
                      <select [(ngModel)]="scheduleDraft.kind" [disabled]="!!editingSchedule">
                        <option value="phase">階段</option>
                        <option value="task">關鍵任務</option>
                      </select></label
                    >
                    <label
                      >名稱 <input [(ngModel)]="scheduleDraft.name"
                    /></label>
                    @if (scheduleDraft.kind === 'task') {
                      <label>負責人或單位 <input [(ngModel)]="scheduleDraft.owner" required /></label>
                      <label>所屬階段 <select [(ngModel)]="scheduleDraft.phaseId"><option value="">直接隸屬專案</option>@for (phase of schedulePhases(); track phase.id) {<option [value]="phase.id">{{ phase.name }}</option>}</select></label>
                    }
                    @if (editingSchedule) {<label>狀態<select [(ngModel)]="scheduleDraft.state"><option value="open">開放</option><option value="in-progress">進行中</option><option value="completed">完成</option><option value="cancelled">取消</option></select></label>}
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
                    @if (editingSchedule) {
                      <label>操作<select [(ngModel)]="scheduleDraft.action"><option value="update">一般修訂</option><option value="correct-original">更正原始資料</option><option value="reopen">重新開啟</option><option value="cancel">取消項目</option><option value="reactivate">重新啟用</option></select></label>
                      <p class="schedule-note">一般改期只調整目前計畫；原始日期誤植時選擇「更正原始資料」。重開時請清除實際完成日。</p>
                      @if (editingSchedule.kind === 'phase' && editingSchedule.state !== 'completed' && scheduleDraft.state === 'completed' && editingSchedule.unfinishedTasks?.length) { <label class="schedule-exception"><input type="checkbox" [(ngModel)]="scheduleDraft.acknowledgeIncompleteTasks" />我已檢視未完成任務，並在修改原因中說明提前確認階段的理由。</label> }
                      <label>修改原因 <input [(ngModel)]="scheduleDraft.reason" required /></label>
                    }
                    <button (click)="saveSchedule()" [disabled]="!token || !scheduleDraft.name.trim() || (scheduleDraft.kind === 'task' && !scheduleDraft.owner.trim()) || (editingSchedule && !scheduleDraft.reason.trim()) || (editingSchedule?.kind === 'phase' && editingSchedule?.state !== 'completed' && scheduleDraft.state === 'completed' && editingSchedule?.unfinishedTasks?.length && !scheduleDraft.acknowledgeIncompleteTasks)">
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
      ])
      .filter((date): date is string => !!date)
      .map((date) => new Date(`${date}T00:00:00`).getTime());
  }
  schedulePosition(date: string | null) {
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
  scheduleWidth(start: string | null, end: string | null) {
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
      (entry) => entry.kind === "phase" && entry.state !== "completed",
    );
  }
  schedulePhases() {
    return this.scheduleEntries.filter(entry => entry.kind === "phase" && entry.state !== "cancelled" && (entry.state !== "completed" || entry.id === this.scheduleDraft.phaseId || this.editingSchedule?.kind === "task" && this.scheduleDraft.state === "completed"));
  }
  phaseName(id: string | null | undefined) {
    return id ? this.scheduleEntries.find(entry => entry.id === id)?.name ?? "未知階段" : "專案直屬";
  }
  scheduleDisplayEntries() {
    const phases = this.scheduleEntries.filter(entry => entry.kind === "phase");
    return [...phases.flatMap(phase => [phase, ...this.scheduleEntries.filter(entry => entry.kind === "task" && entry.phaseId === phase.id)]), ...this.scheduleEntries.filter(entry => entry.kind === "task" && !entry.phaseId), ...this.scheduleEntries.filter(entry => entry.kind !== "phase" && entry.kind !== "task")];
  }
  editSchedule(entry: ScheduleEntry) {
    this.editingSchedule = entry;
    this.scheduleDraft = {
      kind: entry.kind,
      name: entry.name,
      owner: entry.owner ?? "",
      phaseId: entry.phaseId ?? "",
      acknowledgeIncompleteTasks: false,
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
    return ({ open: "開放", "in-progress": "進行中", completed: "完成", cancelled: "取消" })[state];
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
    this.changes.detectChanges();
  }
  async saveSchedule() {
    if (!this.selected) return;
    const value = (date: string) => date || null;
    const body = {
      ...this.scheduleDraft,
      owner: this.scheduleDraft.kind === "task" ? this.scheduleDraft.owner.trim() : null,
      phaseId: this.scheduleDraft.kind === "task" ? this.scheduleDraft.phaseId || null : null,
      baselineStart: value(this.scheduleDraft.baselineStart),
      baselineEnd: value(this.scheduleDraft.baselineEnd),
      forecastStart: this.editingSchedule ? value(this.scheduleDraft.forecastStart) : value(this.scheduleDraft.baselineStart),
      forecastEnd: this.editingSchedule ? value(this.scheduleDraft.forecastEnd) : value(this.scheduleDraft.baselineEnd),
      actualStart: value(this.scheduleDraft.actualStart),
      actualEnd: value(this.scheduleDraft.actualEnd),
    };
    try {
      let result: { projectVersion: number };
      if (this.editingSchedule)
        result = await firstValueFrom(
          this.http.put(
            `/api/items/${this.selected.id}/schedule/${this.editingSchedule.id}`,
            { ...body, baseVersion: this.editingSchedule.version, token: this.token, baseProjectVersion: this.baseVersion },
          ),
        ) as { projectVersion: number };
      else
        result = await firstValueFrom(
          this.http.post(`/api/items/${this.selected.id}/schedule`, { ...body, token: this.token, baseProjectVersion: this.baseVersion }),
        ) as { projectVersion: number };
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
                        <span>{{ entry.name }}</span>
                        <div class="gantt-track">
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
                        </div>
                        <small>偏差：{{ variance(entry) }}</small>
                      </div>
                    }
                  </div>
                }
                @if (item.schedule?.length) {
                  <ul>
                    @for (entry of item.schedule; track entry.id) {
                      <li>
                        <strong
                          >{{
                            entry.kind === "phase" ? "階段" : entry.kind === "task" ? "關鍵任務" : "重要里程碑"
                          }}：{{ entry.name }}</strong
                        >
                        @if (entry.kind === 'task') { · 負責 {{ entry.owner }} }
                        · 基準 {{ entry.baselineStart || "—" }}–{{
                          entry.baselineEnd || "—"
                        }}
                        · 預估 {{ entry.forecastStart || "—" }}–{{
                          entry.forecastEnd || "—"
                        }}
                        · 實際 {{ entry.actualStart || "—" }}–{{
                          entry.actualEnd || "—"
                        }}
                      </li>
                    }
                  </ul>
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
    return entries.filter(entry => entry.kind === "phase");
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
      ])
      .filter((date): date is string => !!date)
      .map((date) => new Date(`${date}T00:00:00`).getTime());
  }
  publicationPosition(entries: ScheduleEntry[], date: string | null) {
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
    start: string | null,
    end: string | null,
  ) {
    return !start || !end
      ? 2
      : Math.max(
          2,
          this.publicationPosition(entries, end) -
            this.publicationPosition(entries, start),
        );
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
