import { Component, computed, inject, input } from "@angular/core";
import { WORK_URL_TEMPLATE } from "./config";

/** 工作編號連結：以新分頁開啟工作系統的單筆工作頁。 */
@Component({
  selector: "a[app-work-link]",
  standalone: true,
  host: { "data-work-link": "", target: "_blank", rel: "noopener", "[attr.href]": "href()" },
  template: `#{{ workId() }}`,
})
export class WorkLink {
  workId = input.required<number>();
  private template = inject(WORK_URL_TEMPLATE);
  href = computed(() => this.template.replace("{id}", String(this.workId())));
}
