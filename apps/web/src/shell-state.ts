import { computed, inject, Injectable, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { CanActivateFn, Router } from "@angular/router";
import { firstValueFrom } from "rxjs";
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

  async loadWeeks() {
    this.weeks.set(await firstValueFrom(this.http.get<string[]>("/api/weeks")).catch(() => []));
  }

  flash(message: string) {
    clearTimeout(this.timer);
    this.toast.set(message);
    this.timer = setTimeout(() => this.toast.set(""), 3000);
  }
}

/** A route naming a week that does not exist goes back home with a toast. */
export const weekGuard: CanActivateFn = async (route) => {
  const state = inject(ShellState);
  const router = inject(Router);
  await state.loadWeeks();
  if (state.weeks().includes(route.paramMap.get("week")!)) return true;
  state.flash("找不到該週");
  return router.parseUrl("/");
};
