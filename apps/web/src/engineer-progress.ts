import { ChangeDetectorRef, Component, effect, HostListener, inject, input, output, signal } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { EngineerBlock } from "./engineer-block";
import { EngineerOverview } from "./engineer-overview";
import { countMarked, displayName, findWork } from "./engineer-model";
import type { BulkCollapse } from "./engineer-work";
import { ShellState } from "./shell-state";

export type EngineerWork = {
  workId: number; workContent: string; status: string; percentage: number; deltaTime: number;
  ownerName?: string; planStartDate?: string; planEndDate?: string; rmsFlag?: string; absent?: boolean; isImportant?: boolean; managerComment?: string; lastComment?: string; subItems?: EngineerWork[];
};
export type EngineerFile = { results: Record<string, { totalWorkHours?: number; totalOffHours?: number; items: EngineerWork[] }> };

export { LONG_HOURS } from "./engineer-work";

@Component({
  selector: "app-engineer-progress",
  standalone: true,
  imports: [EngineerBlock, EngineerOverview],
  template: `<section data-engineer-progress class="eng-layout">
    @if (data) {
      <nav class="eng-roster" aria-label="工程師名冊">
        @for (e of engineers(); track e[0]) {
          <a href="javascript:void(0)" data-roster-item [attr.data-roster]="e[0]" [class.on]="active() === e[0]" [attr.aria-current]="active() === e[0] ? 'location' : null" (click)="$event.preventDefault(); jump('e-' + e[0])">
            <b>{{ displayName(e[0], e[1].items) }}</b>
            <small class="num">{{ e[1].totalWorkHours ?? 0 }}H・<span data-roster-stars>★{{ marked(e[1]).stars }}</span></small>
          </a>
        }
      </nav>
    }
    <div class="eng-main">
    <div class="eng-toolbar" role="toolbar" aria-label="工程師進度工具列">
      @if (editable()) {
        <label>上傳彙整檔 <input type="file" accept=".json,application/json" data-engineer-upload (change)="upload($event)" /></label>
      }
      <label><input type="checkbox" data-only-important [checked]="onlyImportant" (change)="onlyImportant = !onlyImportant" /> 僅看重要</label>
      <button type="button" data-toggle-all (click)="toggleAll()">{{ bulk()?.collapsed ? "全部展開" : "全部收合" }}</button>
    </div>
    @if (error) { <p class="err" role="alert" data-engineer-error>{{ error }}</p> }
    @if (!data) {
      <div class="empty" data-empty>{{ loading ? "載入中…" : editable() ? "本週尚無工程師工作彙整，請先上傳彙整檔" : "本週尚無工程師工作彙整" }}</div>
    } @else {
      <app-engineer-overview [engineers]="engineers()" (jump)="jump($event)" />
      @for (e of engineers(); track e[0]) {
        <app-engineer-block [name]="e[0]" [result]="e[1]" [editable]="editable()" [onlyImportant]="onlyImportant" [bulk]="bulk()" (annotated)="annotate($event.work, $event.isImportant, $event.managerComment)" />
      }
    }
    </div>
  </section>`,
})
export class EngineerProgress {
  private http = inject(HttpClient);
  private changes = inject(ChangeDetectorRef);
  private state = inject(ShellState);
  week = input.required<string>();
  file = input.required<string>();
  editable = input(false);
  /** Emitted with every work of the merged file after a successful upload, so the editor can sync bound items. */
  uploaded = output<EngineerWork[]>();
  data: EngineerFile | null = null;
  onlyImportant = false;
  bulk = signal<BulkCollapse | null>(null);
  loading = false;
  error = "";

  constructor() {
    effect(() => void this.load(this.week(), this.file()));
  }
  toggleAll() {
    this.bulk.set({ collapsed: !this.bulk()?.collapsed });
  }
  active = signal("");
  engineers = () => Object.entries(this.data?.results ?? {});
  displayName = displayName;
  marked = (r: EngineerFile["results"][string]) => countMarked(r.items);

  /** 目前所在的工程師：最後一個標題頂端已捲過視窗上緣附近者。 */
  @HostListener("window:scroll")
  track() {
    const heads = Array.from(document.querySelectorAll<HTMLElement>("[data-engineer]"));
    const atEnd = scrollY + innerHeight >= document.documentElement.scrollHeight - 2; // bottom blocks can't reach the top edge
    const limit = atEnd ? innerHeight : 140;
    this.active.set((heads.filter((h) => h.getBoundingClientRect().top <= limit).pop() ?? heads[0])?.dataset["engineer"] ?? "");
  }

  /** 捲到目標並以 replaceState 寫入 hash（接在路由 hash 之後的第二段），不增加瀏覽器歷史。 */
  jump(id: string, writeHash = true) {
    const el = document.getElementById(id);
    if (!el) return;
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: calm ? "auto" : "smooth", block: "start" });
    if (writeHash) history.replaceState(null, "", `${location.hash.split("#").slice(0, 2).join("#")}#${id}`);
    if (!calm) {
      el.classList.add("flash");
      setTimeout(() => el.classList.remove("flash"), 1500);
    }
    this.track();
  }

  private async load(week: string, file: string) {
    this.loading = true;
    this.data = null;
    this.error = "";
    try {
      const data = await firstValueFrom(this.http.get<EngineerFile>(`/api/weeks/${week}/engineer/${file}`));
      if (week === this.week() && file === this.file()) this.data = data;
    } catch (e: any) {
      if (e?.status !== 404) this.error = `載入失敗：${e?.error?.error ?? e?.status ?? "未知錯誤"}`; // 404: nothing uploaded yet
    }
    this.loading = false;
    this.changes.detectChanges();
    const target = location.hash.split("#")[2];
    if (this.data && target) setTimeout(() => this.jump(target, false));
    this.track();
  }

  async upload(event: Event) {
    const input = event.target as HTMLInputElement;
    const picked = input.files?.[0];
    input.value = "";
    if (!picked) return;
    this.error = "";
    try {
      const { week } = await firstValueFrom(this.http.post<{ week: string }>(`/api/engineer-work?filename=${encodeURIComponent(picked.name)}`, await picked.text(), { headers: { "Content-Type": "application/json" } }));
      this.state.flash(`已上傳 ${week} 工程師彙整`);
      if (week === this.week()) {
        await this.load(week, this.file());
        this.uploaded.emit(Object.values(this.data?.results ?? {}).flatMap((r) => r.items));
      }
      else this.error = `檔案屬於 ${week}，請切換到該週查看`;
    } catch (e: any) {
      this.error = `上傳失敗：${e?.error?.error ?? "未知錯誤"}`;
    }
    this.changes.detectChanges();
  }

  async annotate(work: EngineerWork, isImportant: boolean, managerComment: string) {
    this.error = "";
    try {
      await firstValueFrom(this.http.put(`/api/weeks/${this.week()}/engineer/${this.file()}/works/${work.workId}`, { isImportant, managerComment }));
      for (const target of [work, ...Object.values(this.data?.results ?? {}).map((r) => findWork(r.items, work.workId))]) { // work may be a filtered copy
        if (target) Object.assign(target, { isImportant, managerComment });
      }
    } catch (e: any) {
      const reason = e?.error?.error ?? e?.status ?? "未知錯誤";
      await this.load(this.week(), this.file()); // drop the unsaved input so the page matches the server
      this.error = `儲存標註失敗：${reason}`;
    }
    this.changes.detectChanges();
  }
}
