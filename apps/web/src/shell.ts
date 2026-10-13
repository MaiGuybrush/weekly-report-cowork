import { Component, inject, signal } from "@angular/core";
import { NavigationEnd, Router, RouterLink, RouterOutlet } from "@angular/router";
import { filter } from "rxjs";
import { ShellState } from "./shell-state";
import { weekStatus } from "./week-status";

@Component({
  selector: "app-shell",
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  template: `<header class="top" data-shell>
      <b>處會週報</b>
      <nav>
        <a data-nav="home" routerLink="/" [class.on]="screen() === 'home'">首頁</a>
        <a data-nav="edit" [routerLink]="editLink()" [class.on]="screen() === 'edit'">編輯</a>
        @if (state.latest(); as l) {
          <a data-nav="pub" [routerLink]="['/publications', l.week, l.version]" [class.on]="screen() === 'pub'">正式版</a>
        }
      </nav>
      <div class="weeks">
        @for (w of recent(); track w) {
          <a data-week-pill [routerLink]="weekLink(w)" [class.on]="w === currentWeek()">{{ w.slice(5) }}</a>
        }
      </div>
      @if (state.me(); as me) {
        <div class="who">{{ me.name }}<i>{{ me.role === "Division" ? "部級" : "課長" }}</i></div>
      }
    </header>
    <router-outlet />
    @if (state.toast()) { <div class="toast" role="status">{{ state.toast() }}</div> }`,
})
export class Shell {
  state = inject(ShellState);
  private url = signal(inject(Router).url);

  constructor() {
    const router = inject(Router);
    router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      this.url.set(e.urlAfterRedirects);
      this.state.refresh();
    });
  }

  screen = () => (this.url().startsWith("/weeks/") ? "edit" : this.url().startsWith("/publications/") ? "pub" : "home");
  currentWeek = () => this.url().match(/^\/(?:weeks|publications)\/([^/]+)/)?.[1];
  recent = () => this.state.weeks().slice(0, 3);
  editLink = () => (this.state.weeks()[0] ? `/weeks/${this.state.weeks()[0]}` : "/");

  /** Switching week keeps the file and tab segments of the current edit URL; on a publication it opens that week's latest version. */
  weekLink(week: string) {
    const url = this.url();
    if (url.startsWith("/weeks/")) return url.replace(/^\/weeks\/[^/]+/, `/weeks/${week}`);
    const { published, version } = weekStatus(this.state.publications(), week);
    return this.screen() === "pub" && published ? `/publications/${week}/${version}` : `/weeks/${week}`;
  }
}
