import { ChangeDetectorRef, Component, inject, OnInit } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { ActivatedRoute } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { ProjectSchedule } from "./project-schedule";
import { publishedDate } from "./week-status";
import { FILE_LABELS, SECTION_LABELS, type CrossFile, type NonProjectSection, type PublicationIndex, type SectionFile, type SectionItem } from "./report-types";

type Entry = PublicationIndex["publications"][number];

/** Latest = highest version of the newest week. */
export function latestPublication(index: PublicationIndex): Entry | undefined {
  return [...index.publications].sort((a, b) => b.week.localeCompare(a.week) || b.version - a.version)[0];
}

@Component({
  standalone: true,
  imports: [ProjectSchedule],
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
        @for (file of files; track file) {
          @if (hasContent(file)) {
            <section [attr.data-file]="file">
              <h2>{{ FILE_LABELS[file] }}</h2>
              @for (p of itemsOf(file, "projects"); track p.id) { <app-project-schedule [project]="p" [document]="true" /> }
              @for (key of sectionKeys; track key) {
                @if (itemsOf(file, key).length) {
                  <h3>{{ SECTION_LABELS[key] }}</h3>
                  @for (item of itemsOf(file, key); track item.id) {
                    <div class="item-doc">
                      <b>{{ item.title }}</b>
                      <p class="body">{{ item.content }}</p>
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
        }
      </article>
    </main>`,
})
export class PublicationPage implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private changes = inject(ChangeDetectorRef);
  readonly SECTION_LABELS = SECTION_LABELS;
  readonly FILE_LABELS = FILE_LABELS;
  readonly publishedDate = publishedDate;
  readonly sectionKeys = Object.keys(SECTION_LABELS) as NonNullable<NonProjectSection[]>;
  readonly files = ["s1", "s2", "s3"];
  week = "";
  version = 0;
  entries: Entry[] = [];
  data: Record<string, Partial<SectionFile & CrossFile>> = {};
  message = "";
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
  print = () => window.print();
  /** A section with no project and no item gets no heading. */
  hasContent = (file: string) => !!this.data[file]?.items?.length;
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

  itemsOf = (file: string, section: string): SectionItem[] => (this.data[file]?.items ?? []).filter((i) => i.section === section);

  private async load(week: string, version: number) {
    try {
      this.entries = (await firstValueFrom(this.http.get<PublicationIndex>("/api/publications"))).publications
        .sort((a, b) => b.week.localeCompare(a.week) || b.version - a.version);
      this.data = await firstValueFrom(this.http.get<typeof this.data>(`/api/publications/${week}/${version}`));
      for (const d of Object.values(this.data)) for (const i of d.items ?? []) i.details ??= {};
      this.week = week;
      this.version = version;
      this.message = "";
    } catch {
      this.message = "找不到此正式版。";
    }
    this.changes.detectChanges();
  }
}
