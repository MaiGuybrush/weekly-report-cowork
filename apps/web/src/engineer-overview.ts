import { Component, computed, input, output, signal } from "@angular/core";
import type { EngineerFile } from "./engineer-progress";
import { hoursAlert, sectionTotals, topWorks } from "./engineer-model";

/** 工時總覽：每人工時、休假、主要耗時工作與工時警示，末列為課別合計。 */
@Component({
  selector: "app-engineer-overview",
  standalone: true,
  template: `<section class="eng-overview" data-overview>
    <button type="button" data-overview-toggle [attr.aria-expanded]="open()" (click)="open.set(!open())">{{ open() ? "▾" : "▸" }} 工時總覽</button>
    @if (open()) {
      <div class="eng-overview-scroll">
        <table>
          <thead><tr><th>姓名</th><th>工作時數</th><th>休假時數</th><th>主要耗時工作</th></tr></thead>
          <tbody>
            @for (e of engineers(); track e[0]) {
              <tr [attr.data-overview-row]="e[0]" [attr.data-alert]="alert(e[1])">
                <td><a href="javascript:void(0)" data-overview-name (click)="$event.preventDefault(); jump.emit('e-' + e[0])">{{ e[0] }}</a></td>
                <td class="num">{{ e[1].totalWorkHours ?? 0 }}H @if (alert(e[1]) === "short") { <em data-alert-note>不足</em> } @else if (alert(e[1]) === "over") { <em data-alert-note>過量</em> }</td>
                <td class="num" [class.dim]="!e[1].totalOffHours">{{ e[1].totalOffHours ?? 0 }}H</td>
                <td>@for (w of topWorks(e[1].items); track w.workId) {
                  <a href="javascript:void(0)" data-overview-work (click)="$event.preventDefault(); jump.emit('w' + w.workId)">{{ w.workContent }}（{{ w.deltaTime }}H）</a>
                }</td>
              </tr>
            }
          </tbody>
          <tfoot><tr data-overview-total><td>合計</td><td class="num">{{ totals().work }}H</td><td class="num">{{ totals().off }}H</td><td></td></tr></tfoot>
        </table>
      </div>
    }
  </section>`,
})
export class EngineerOverview {
  engineers = input.required<[string, EngineerFile["results"][string]][]>();
  jump = output<string>();
  open = signal(true);
  totals = computed(() => sectionTotals(this.engineers().map((e) => e[1])));
  topWorks = topWorks;
  alert = (r: EngineerFile["results"][string]) => hoursAlert(r.totalWorkHours ?? 0, r.totalOffHours ?? 0);
}
