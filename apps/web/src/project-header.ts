import { Component, input } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { projectHealth } from "./project-health";
import type { SectionItem } from "./report-types";

const SECTIONS = [["s1", "第一課"], ["s2", "第二課"], ["s3", "第三課"]];

@Component({
  selector: "app-project-header",
  standalone: true,
  imports: [FormsModule],
  template: `
    <label>專案名稱
      <input data-field="project-title" [(ngModel)]="project().title" [disabled]="!editable()" /></label>
    <label>實際專案負責人
      <input data-field="project-owner" [(ngModel)]="project().owner" [disabled]="!editable()" /></label>
    <p>參與課別：
      @for (s of SECTIONS; track s[0]) {
        <label><input type="checkbox" [disabled]="!editable()" [checked]="has(s[0])" (change)="toggle(s[0])" /> {{ s[1] }}</label>
      }
      @if (!editable() && !project().participants?.length) { 無 }
    </p>
    <p [attr.data-health]="health().status">
      <span [class]="'pill ' + health().status">{{ health().text }}</span>
      <span class="pill mute num">{{ health().progress }}</span>
    </p>`,
})
export class ProjectHeader {
  project = input.required<SectionItem>();
  editable = input(false);
  readonly SECTIONS = SECTIONS;

  // recomputed every check so in-place edits show immediately; cheap (one pass over the schedule)
  health = () => projectHealth(this.project().schedule);

  has = (s: string) => !!this.project().participants?.includes(s);
  toggle(s: string) {
    const p = this.project();
    const list = p.participants ?? [];
    p.participants = list.includes(s) ? list.filter((x) => x !== s) : [...list, s];
  }
}
