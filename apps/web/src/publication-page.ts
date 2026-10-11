import { ChangeDetectorRef, Component, inject, OnInit } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { ActivatedRoute } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { ProjectSchedule } from "./project-schedule";
import { FILE_LABELS, SECTION_LABELS } from "./week-editor";
import type { CrossFile, NonProjectSection, PublicationIndex, SectionFile, SectionItem } from "./report-types";

type Entry = PublicationIndex["publications"][number];

/** Latest = highest version of the newest week. */
export function latestPublication(index: PublicationIndex): Entry | undefined {
  return [...index.publications].sort((a, b) => b.week.localeCompare(a.week) || b.version - a.version)[0];
}

@Component({
  standalone: true,
  imports: [ProjectSchedule],
  template: `<header>
      <h1>正式版 {{ week }} v{{ version }}</h1>
      <a href="#/">返回</a>
    </header>
    <main>
      <label>版本
        <select data-version-select (change)="select($any($event.target).value)">
          @for (p of entries; track p.path) {
            <option [value]="p.week + '/' + p.version" [selected]="p.week === week && p.version === version">{{ p.week }} v{{ p.version }}（{{ p.publishedAt.slice(0, 10) }}）</option>
          }
        </select></label>
      @if (message) { <p class="message" role="status">{{ message }}</p> }
      @for (file of files; track file) {
        <section class="card" [attr.data-file]="file">
          <h2>{{ FILE_LABELS[file] }}</h2>
          @for (p of itemsOf(file, "projects"); track p.id) { <app-project-schedule [project]="p" [editable]="false" /> }
          @for (key of sectionKeys; track key) {
            @if (itemsOf(file, key).length) {
              <h3>{{ SECTION_LABELS[key] }}</h3>
              @for (item of itemsOf(file, key); track item.id) {
                <div class="item"><strong>{{ item.title }}</strong><p>{{ item.content }}</p></div>
              }
            }
          }
        </section>
      }
      <section class="card" data-file="cross">
        <h2>跨課</h2>
        <p>{{ cross.managementSummary }}</p>
        <h3>待決策事項</h3>
        @for (d of cross.pendingDecisions ?? []; track d.id) {
          <div class="item">{{ d.description }}@if (d.result) { → {{ d.result }} }</div>
        }
      </section>
    </main>`,
})
export class PublicationPage implements OnInit {
  private http = inject(HttpClient);
  private route = inject(ActivatedRoute);
  private changes = inject(ChangeDetectorRef);
  readonly SECTION_LABELS = SECTION_LABELS;
  readonly FILE_LABELS = FILE_LABELS;
  readonly sectionKeys = Object.keys(SECTION_LABELS) as NonNullable<NonProjectSection[]>;
  readonly files = ["s1", "s2", "s3"];
  week = "";
  version = 0;
  entries: Entry[] = [];
  data: Record<string, Partial<SectionFile & CrossFile>> = {};
  message = "";
  get cross() { return (this.data["cross"] ?? {}) as Partial<CrossFile>; }

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
