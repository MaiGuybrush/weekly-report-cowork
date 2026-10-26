import { ChangeDetectorRef, Component, effect, inject, input } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { NgTemplateOutlet } from "@angular/common";
import { firstValueFrom } from "rxjs";
import { ShellState } from "./shell-state";

export type EngineerWork = {
  workId: number; workContent: string; status: string; percentage: number; deltaTime: number;
  rmsFlag?: string; absent?: boolean; subItems?: EngineerWork[];
};
export type EngineerFile = { results: Record<string, { totalWorkHours?: number; totalOffHours?: number; items: EngineerWork[] }> };

/** 耗時達此值（小時）的工作加註標示。 */
export const LONG_HOURS = 10;

@Component({
  selector: "app-engineer-progress",
  standalone: true,
  imports: [NgTemplateOutlet],
  template: `<section data-engineer-progress>
    @if (editable()) {
      <p><label>上傳工程師工作彙整 JSON <input type="file" accept=".json,application/json" data-engineer-upload (change)="upload($event)" /></label></p>
    }
    @if (error) { <p class="err" role="alert" data-engineer-error>{{ error }}</p> }
    @if (!data) {
      <div class="empty" data-empty>{{ loading ? "載入中…" : "本週尚無工程師工作彙整" }}</div>
    } @else {
      @for (e of engineers(); track e[0]) {
        <h3 data-engineer>{{ e[0] }} <small class="num">工時 {{ e[1].totalWorkHours ?? 0 }}H・休假 {{ e[1].totalOffHours ?? 0 }}H</small></h3>
        <ul class="work-tree">
          <ng-container *ngTemplateOutlet="tree; context: { $implicit: e[1].items }" />
        </ul>
      }
    }
    <ng-template #tree let-items>
      @for (w of items; track w.workId) {
        <li [attr.data-work]="w.workId" [attr.data-absent]="w.absent ? '' : null">
          <span class="num">#{{ w.workId }}</span> {{ w.workContent }}
          <span class="num">{{ w.status }}・{{ w.percentage }}%・{{ w.deltaTime }}H</span>
          @if (w.deltaTime >= LONG_HOURS) { <em data-long>耗時 ≥{{ LONG_HOURS }}H</em> }
          @if (w.rmsFlag) { <em data-rms>RMS</em> }
          @if (w.absent) { <em data-absent-note>本週彙整未出現此工作（可能本週無進度）</em> }
          @if (w.subItems?.length) { <ul><ng-container *ngTemplateOutlet="tree; context: { $implicit: w.subItems }" /></ul> }
        </li>
      }
    </ng-template>
  </section>`,
})
export class EngineerProgress {
  private http = inject(HttpClient);
  private changes = inject(ChangeDetectorRef);
  private state = inject(ShellState);
  readonly LONG_HOURS = LONG_HOURS;
  week = input.required<string>();
  file = input.required<string>();
  editable = input(false);
  data: EngineerFile | null = null;
  loading = false;
  error = "";

  constructor() {
    effect(() => void this.load(this.week(), this.file()));
  }
  engineers = () => Object.entries(this.data?.results ?? {});

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
      if (week === this.week()) await this.load(week, this.file());
      else this.error = `檔案屬於 ${week}，請切換到該週查看`;
    } catch (e: any) {
      this.error = `上傳失敗：${e?.error?.error ?? "未知錯誤"}`;
    }
    this.changes.detectChanges();
  }
}
