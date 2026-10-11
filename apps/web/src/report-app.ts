import { ChangeDetectorRef, Component, inject, OnInit } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { RouterOutlet, Routes } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { WeekEditor } from "./week-editor";
import { latestPublication, PublicationPage as WeekPublication } from "./publication-page";
import { editorGuard } from "./auth";

type User = { empNo: string; name: string; role: string; section: string | null };

@Component({
  selector: "app-root",
  standalone: true,
  imports: [RouterOutlet],
  template: "<router-outlet />",
})
export class App {}

@Component({
  standalone: true,
  template: ` <header>
      <h1>處會週報</h1>
      <span>{{ me?.name }} · {{ me?.role }}</span>
    </header>
    <main>
      <section class="card">
        @if (message) {
          <p class="message">{{ message }}</p>
        }
        @if (latest) { <p><a data-latest-publication href="#/publications/{{ latest.week }}/{{ latest.version }}">最新正式版 {{ latest.week }} v{{ latest.version }}</a></p> }
        <h2>週次</h2>
        @if (me?.role === "Division") { <button data-create-week (click)="createWeek()">建立下週</button> }
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
  private changes = inject(ChangeDetectorRef);
  me: User | null = null;
  weeks: string[] = [];
  latest?: { week: string; version: number };
  message = "";
  async ngOnInit() {
    this.me = await firstValueFrom(this.http.get<User>("/api/me"));
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
}

@Component({
  standalone: true,
  template: "<main><h1>無權限</h1><p>此帳號無法編輯處會週報。</p></main>",
})
export class Forbidden {}

export const routes: Routes = [
  { path: "", component: Home, canActivate: [editorGuard] },
  { path: "weeks/:week", component: WeekEditor, canActivate: [editorGuard] },
  { path: "publications/:week/:version", component: WeekPublication, canActivate: [editorGuard] },
  { path: "forbidden", component: Forbidden },
  { path: "**", redirectTo: "" },
];
