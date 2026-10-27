import { ChangeDetectorRef, Component, inject, OnInit } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { ActivatedRoute } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { ProjectSchedule } from "./project-schedule";
import { type Chapter, chaptersOf, systemGroupsOf } from "./report-chapters";
import { publishedDate } from "./week-status";
import { appendixRows, baselineOf, deltaText, previousWeek } from "./work-binding";
import { WorkLink } from "./work-link";
import { APPENDIX_LABEL, SECTION_LABELS, UNCLASSIFIED_LABEL, type CrossFile, type PublicationIndex, type SectionFile, type SectionItem } from "./report-types";

type Entry = PublicationIndex["publications"][number];

/** Latest = highest version of the newest week. */
export function latestPublication(index: PublicationIndex): Entry | undefined {
  return [...index.publications].sort((a, b) => b.week.localeCompare(a.week) || b.version - a.version)[0];
}

@Component({
  standalone: true,
  imports: [ProjectSchedule, WorkLink],
  template: `<main class="pub-wrap">
      <article class="doc">
        <div class="doc-head">
          <div>
            <div class="ver" data-doc-version>{{ week }} · v{{ version }}@if (isOld) { <span class="pill mute" data-old-version>舊版</span> }</div>
            <h1>處會週報</h1>
          </div>
          <div class="sp">
            <select data-version-select aria-label="版本" (change)="select($any($event.target).value)">
              @for (g of groups; track g.week) {
                <optgroup [label]="g.week">
                  @for (p of g.entries; track p.path) {
                    <option [value]="p.week + '/' + p.version" [selected]="p.week === week && p.version === version">v{{ p.version }} · {{ publishedDate(p.publishedAt) }} 發布</option>
                  }
                </optgroup>
              }
            </select>
            <button type="button" data-print (click)="print()">列印</button>
          </div>
        </div>
        @if (message) { <p class="message" role="status">{{ message }}</p> }
        <section data-file="cross">
          <h2 style="margin-top:0">管理摘要</h2>
          <p class="summary">{{ cross.managementSummary }}</p>
          @if (cross.pendingDecisions?.length) {
            <h3>待決策事項</h3>
            @for (d of cross.pendingDecisions; track d.id) {
              <div class="dec">
                <span>{{ d.description }}</span>
                <span class="r">@if (d.result) { {{ d.result }}@if (d.newDueDate) { （新到期日 {{ d.newDueDate }}） } } @else { <span class="mute">待決議</span> }</span>
              </div>
            }
          }
        </section>
        @for (c of chapters; track c.section) {
          <section [attr.data-chapter]="c.section">
            <h2>{{ SECTION_LABELS[c.section] }}</h2>
            @for (g of blocksOf(c); track $index) {
              @if (g.heading) { <h3 data-system-group>{{ g.heading }}</h3> }
              @for (item of g.items; track item.id) {
              @if (c.section === "projects") {
                <app-project-schedule [project]="item" [document]="true" [baseDate]="baseDate" [baseline]="baseline" />
              } @else {
                <div class="item-doc">
                  <b>@if (item.workId != null) { <a app-work-link [workId]="item.workId" [text]="item.title"></a> } @else { {{ item.title }} }</b>
                  <p class="body">{{ item.content }}@if (deltaText(item.workId, item.engineerProgress, baseline); as d) { <strong data-progress-delta> （{{ d }}）</strong> }</p>
                  @if (impactLine(item); as line) { <p data-impact-line>{{ line }}</p> }
                  @if (item.details.sourceLinks?.length) {
                    <p class="links" data-source-links>
                      @for (l of item.details.sourceLinks; track $index) { <a [href]="l.url" target="_blank" rel="noopener">{{ l.label || l.url }}</a> }
                    </p>
                  }
                </div>
              }
            }
            }
          </section>
        }
        @if (appendix.length) {
          <section data-appendix>
            <h2>{{ APPENDIX_LABEL }}</h2>
            <table class="grid">
              <thead><tr><th>工作編號</th><th>工作內容</th><th>進度</th><th>變動</th></tr></thead>
              <tbody>
                @for (r of appendix; track r.workId) {
                  <tr data-appendix-row><td class="num"><a app-work-link [workId]="r.workId"></a></td><td>{{ r.content }}</td><td class="num">{{ r.progress }}%</td><td class="num">{{ r.delta }}</td></tr>
                }
              </tbody>
            </table>
          </section>
        }
      </article>
    </main>`,
})
export class PublicationPage implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private changes = inject(ChangeDetectorRef);
  readonly SECTION_LABELS = SECTION_LABELS;
  readonly publishedDate = publishedDate;
  readonly deltaText = deltaText;
  readonly APPENDIX_LABEL = APPENDIX_LABEL;
  readonly files = ["s1", "s2", "s3"];
  week = "";
  version = 0;
  entries: Entry[] = [];
  data: Record<string, Partial<SectionFile & CrossFile>> = {};
  message = "";
  /** Progress in the previous week's last official version; empty when that week was never published. */
  baseline = new Map<number, number>();
  get chapters() { return chaptersOf(this.files.map((f) => this.data[f])); }
  get appendix() { return appendixRows(this.files.map((f) => this.data[f]), this.baseline); }
  get cross() { return (this.data["cross"] ?? {}) as Partial<CrossFile>; }
  /** Weeks newest first, versions newest first inside each week (entries arrive sorted that way). */
  get groups() {
    const weeks = [...new Set(this.entries.map((p) => p.week))];
    return weeks.map((w) => ({ week: w, entries: this.entries.filter((p) => p.week === w) }));
  }
  get isOld() {
    const latest = this.entries[0];
    return !!latest && (latest.week !== this.week || latest.version !== this.version);
  }
  /** 基準日 of a published view = that version's publish date. */
  get baseDate() { return this.entries.find((p) => p.week === this.week && p.version === this.version)?.publishedAt.slice(0, 10); }
  /** Maintenance splits into 系統別 groups with a heading; every other chapter is one headingless block. */
  blocksOf(c: Chapter) {
    return c.section === "operations"
      ? systemGroupsOf(c.items).map((g) => ({ heading: g.system ?? UNCLASSIFIED_LABEL, items: g.items }))
      : [{ heading: "", items: c.items }];
  }
  print = () => window.print();
  /** 交接／影響／下一步（生效日）, skipping parts that were left empty. */
  impactLine(item: SectionItem) {
    const d = item.details;
    const parts = [["交接", d.handover], ["影響", d.impact], ["下一步", d.nextStep]].filter(([, v]) => v).map(([k, v]) => `${k}：${v}`);
    if (!parts.length) return "";
    return parts.join("；") + (d.effectiveDate ? `（${d.effectiveDate} 生效）` : "");
  }

  ngOnInit() {
    this.route.paramMap.subscribe((p) => this.load(p.get("week")!, Number(p.get("version"))));
  }

  select(value: string) {
    location.hash = `#/publications/${value}`;
  }

  private async loadBaseline(week: string) {
    const prev = previousWeek(week);
    const version = Math.max(0, ...this.entries.filter((p) => p.week === prev).map((p) => p.version));
    if (!version) return new Map<number, number>();
    try {
      const snap = await firstValueFrom(this.http.get<typeof this.data>("/api/publications/" + prev + "/" + version));
      return baselineOf(this.files.map((f) => snap[f]));
    } catch {
      return new Map<number, number>();
    }
  }

  private async load(week: string, version: number) {
    try {
      this.entries = (await firstValueFrom(this.http.get<PublicationIndex>("/api/publications"))).publications
        .sort((a, b) => b.week.localeCompare(a.week) || b.version - a.version);
      this.data = await firstValueFrom(this.http.get<typeof this.data>(`/api/publications/${week}/${version}`));
      for (const d of Object.values(this.data)) for (const i of d.items ?? []) i.details ??= {};
      this.baseline = await this.loadBaseline(week);
      this.week = week;
      this.version = version;
      this.message = "";
    } catch {
      this.message = "找不到此正式版。";
    }
    this.changes.detectChanges();
  }
}
