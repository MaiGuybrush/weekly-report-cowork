import { ChangeDetectorRef, Component, inject, OnInit } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { latestPublication } from "./publication-page";

type User = { empNo: string; name: string; role: string; section: string | null };

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
