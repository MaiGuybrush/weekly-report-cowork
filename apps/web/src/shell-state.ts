import { computed, inject, Injectable, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { CanActivateFn, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { resolveEdit } from "./edit-nav";
import { latestPublication } from "./publication-page";
import type { PublicationIndex } from "./report-types";

export type User = { empNo: string; name: string; role: string; section: string | null };

/** What the shell and home share: who I am, which weeks exist, what is published, and the toast. */
@Injectable({ providedIn: "root" })
export class ShellState {
  private http = inject(HttpClient);
  private timer?: ReturnType<typeof setTimeout>;
  me = signal<User | null>(null);
  weeks = signal<string[]>([]);
  publications = signal<PublicationIndex["publications"]>([]);
  latest = computed(() => latestPublication({ publications: this.publications() }));
  loaded = signal(false);
  toast = signal("");

  async refresh() {
    try {
      const [me, weeks, index] = await Promise.all([
        this.me() ?? firstValueFrom(this.http.get<User>("/api/me")),
        firstValueFrom(this.http.get<string[]>("/api/weeks")),
        firstValueFrom(this.http.get<PublicationIndex>("/api/publications")),
      ]);
      this.me.set(me);
      this.weeks.set(weeks);
      this.publications.set(index.publications);
    } catch {
      this.flash("無法載入資料");
    }
    this.loaded.set(true);
  }

  async ensureMe() {
    if (!this.me()) this.me.set(await firstValueFrom(this.http.get<User>("/api/me")));
    return this.me()!;
  }

  async loadWeeks() {
    this.weeks.set(await firstValueFrom(this.http.get<string[]>("/api/weeks")).catch(() => []));
  }

  flash(message: string) {
    clearTimeout(this.timer);
    this.toast.set(message);
    this.timer = setTimeout(() => this.toast.set(""), 3000);
  }
}

/** True when the week exists; reloads the list once if it is not known yet (another user may have created it). */
async function weekExists(state: ShellState, week: string) {
  if (!state.weeks().includes(week)) await state.loadWeeks();
  return state.weeks().includes(week);
}

/** A route naming a week that does not exist goes back home with a toast. */
export const weekGuard: CanActivateFn = async (route) => {
  const state = inject(ShellState);
  if (await weekExists(state, route.paramMap.get("week")!)) return true;
  state.flash("找不到該週");
  return inject(Router).parseUrl("/");
};

/** Edit URLs: fill a missing file/tab with the role default, bounce unknown weeks/files/tabs home with a toast. */
export const editGuard: CanActivateFn = async (route) => {
  const state = inject(ShellState);
  const router = inject(Router);
  const week = route.paramMap.get("week")!;
  if (!(await weekExists(state, week))) {
    state.flash("找不到該週");
    return router.parseUrl("/");
  }
  const file = route.paramMap.get("file");
  const tab = route.paramMap.get("tab");
  const target = resolveEdit(await state.ensureMe(), file, tab);
  if (!target) {
    state.flash("找不到該課別或頁籤");
    return router.parseUrl("/");
  }
  return file === target.file && tab === target.tab ? true : router.parseUrl(`/weeks/${week}/${target.file}/${target.tab}`);
};
