import { Component } from "@angular/core";
import { Routes } from "@angular/router";
import { Home } from "./home";
import { WeekEditor } from "./week-editor";
import { PublicationPage } from "./publication-page";
import { editorGuard } from "./auth";
import { Shell } from "./shell";
import { editGuard, weekGuard } from "./shell-state";

@Component({
  standalone: true,
  template: '<main class="center-card" role="alert"><h1>無權限</h1><p>此帳號無法編輯處會週報。</p></main>',
})
export class Forbidden {}

export const routes: Routes = [
  {
    path: "",
    component: Shell,
    canActivateChild: [editorGuard],
    children: [
      { path: "", component: Home },
      // the short forms never render: editGuard redirects them to the full URL
      { path: "weeks/:week", component: WeekEditor, canActivate: [editGuard] },
      { path: "weeks/:week/:file", component: WeekEditor, canActivate: [editGuard] },
      { path: "weeks/:week/:file/:tab", component: WeekEditor, canActivate: [editGuard] },
      { path: "publications/:week/:version", component: PublicationPage, canActivate: [weekGuard] },
    ],
  },
  { path: "forbidden", component: Forbidden },
  { path: "**", redirectTo: "" },
];
