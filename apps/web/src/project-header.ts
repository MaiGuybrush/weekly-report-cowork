import { Component, input } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { localToday } from "./gantt-model";
import { projectHealth } from "./project-health";
import { projectProgressText } from "./project-progress";
import type { SectionItem } from "./report-types";

const SECTIONS = [["s1", "第一課"], ["s2", "第二課"], ["s3", "第三課"]];

@Component({
  selector: "app-project-header",
  standalone: true,
  imports: [FormsModule],
  template: `
    @if (document()) {
      <div class="pj-title">
        <b data-project-title>{{ project().title }}</b>
        <span>負責人 {{ project().owner || "—" }} · {{ participantNames() || "無" }}</span>
        <span [attr.data-health]="health().status">
          <span [class]="'pill ' + health().status">{{ health().text }}</span>
          <span class="pill mute num">{{ health().progress }}</span>
          <span class="pill mute num" data-overall-progress>整體進度 {{ overall() }}</span>
        </span>
      </div>
    } @else {
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
      <span class="pill mute num" data-overall-progress>整體進度 {{ overall() }}</span>
    </p>
    }`,
})
export class ProjectHeader {
  project = input.required<SectionItem>();
  editable = input(false);
  /** Publication layout: plain text title line instead of form fields. */
  document = input(false);
  readonly SECTIONS = SECTIONS;

  // recomputed every check so in-place edits show immediately; cheap (one pass over the schedule)
  health = () => projectHealth(this.project().schedule ?? [], localToday());

  overall = () => projectProgressText(this.project().schedule ?? []);

  participantNames = () => SECTIONS.filter((s) => this.has(s[0])).map((s) => s[1]).join("、");
  has = (s: string) => !!this.project().participants?.includes(s);
  toggle(s: string) {
    const p = this.project();
    const list = p.participants ?? [];
    p.participants = list.includes(s) ? list.filter((x) => x !== s) : [...list, s];
  }
}
