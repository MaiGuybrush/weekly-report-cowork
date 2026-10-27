import { ChangeDetectorRef, Component, effect, inject, input, output } from "@angular/core";
import { HttpClient } from "@angular/common/http";
import { firstValueFrom } from "rxjs";
import { EngineerBlock } from "./engineer-block";
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
  imports: [EngineerBlock],
  template: `<section data-engineer-progress>
    @if (editable()) {
      <p><label>上傳工程師工作彙整 JSON <input type="file" accept=".json,application/json" data-engineer-upload (change)="upload($event)" /></label></p>
    }
    <p><label><input type="checkbox" data-only-important [checked]="onlyImportant" (change)="onlyImportant = !onlyImportant" /> 僅顯示重要工作</label></p>
    @if (error) { <p class="err" role="alert" data-engineer-error>{{ error }}</p> }
    @if (!data) {
      <div class="empty" data-empty>{{ loading ? "載入中…" : "本週尚無工程師工作彙整" }}</div>
    } @else {
      @for (e of engineers(); track e[0]) {
        <app-engineer-block [name]="e[0]" [result]="e[1]" [editable]="editable()" [onlyImportant]="onlyImportant" (annotated)="annotate($event.work, $event.isImportant, $event.managerComment)" />
      }
    }
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
      work.isImportant = isImportant;
      work.managerComment = managerComment;
    } catch (e: any) {
      const reason = e?.error?.error ?? e?.status ?? "未知錯誤";
      await this.load(this.week(), this.file()); // drop the unsaved input so the page matches the server
      this.error = `儲存標註失敗：${reason}`;
    }
    this.changes.detectChanges();
  }
}
