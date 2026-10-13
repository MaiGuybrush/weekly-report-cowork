import { Component, inject } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { RouterLink } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { FILE_LABELS } from "./report-types";
import { ShellState } from "./shell-state";
import { publishedDate, weekStatus } from "./week-status";

@Component({
  standalone: true,
  imports: [RouterLink],
  template: `<main class="home">
    @if (!state.loaded()) {
      <p role="status">載入中…</p>
    } @else {
      @if (state.latest(); as l) {
        <a class="latest" data-latest-publication [routerLink]="['/publications', l.week, l.version]">
          <span class="big">{{ l.week.slice(5) }}</span>
          <span><small>最新正式版</small>{{ l.week }} v{{ l.version }} · {{ date(l.publishedAt) }} 發布</span>
          <span>閱讀 ›</span>
        </a>
      } @else {
        <div class="empty" data-no-publication>尚無正式版</div>
      }
      <div>
        <h2>週次</h2>
        <ul class="weeklist">
          @for (week of state.weeks(); track week) {
            <li><a [routerLink]="['/weeks', week]">
              <span class="w">{{ week }}</span>
              <span class="pill" [class.ok]="status(week).published" [class.warn]="!status(week).published" data-week-status>{{ status(week).text }}</span>
            </a></li>
          }
        </ul>
      </div>
      @if (state.me(); as me) {
        <div>
          <h2>{{ me.name }}</h2>
          <div class="hint" data-role-hint>
            <p><b>你可以：</b></p>
            @if (me.role === "Division") {
              <p>• 編輯管理摘要與待決策事項</p>
              <p>• 發布本週正式版</p>
              <p>• 建立下週</p>
              @if (message) { <p class="message" role="status">{{ message }}</p> }
              <p><button class="pri" data-create-week (click)="createWeek()">建立下週</button></p>
            } @else {
              <p>• 編輯{{ sectionLabel(me.section) }}的專案與各分項</p>
              <p>• 其他課與跨課內容唯讀</p>
            }
          </div>
        </div>
      }
    }
  </main>`,
})
export class Home {
  private http = inject(HttpClient);
  state = inject(ShellState);
  message = "";
  status = (week: string) => weekStatus(this.state.publications(), week);
  date = publishedDate;
  sectionLabel = (section: string | null) => FILE_LABELS[section ?? ""] ?? "本課";

  async createWeek() {
    this.message = "";
    try {
      await firstValueFrom(this.http.post("/api/weeks", {}));
      await this.state.refresh();
    } catch {
      this.message = "無法建立下週（可能已存在）。";
    }
  }
}
