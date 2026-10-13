import { Component } from "@angular/core";
import { Routes } from "@angular/router";
import { Home } from "./home";
import { WeekEditor } from "./week-editor";
import { PublicationPage } from "./publication-page";
import { editorGuard } from "./auth";

@Component({
  standalone: true,
  template: "<main><h1>無權限</h1><p>此帳號無法編輯處會週報。</p></main>",
})
export class Forbidden {}

export const routes: Routes = [
  { path: "", component: Home, canActivate: [editorGuard] },
  { path: "weeks/:week", component: WeekEditor, canActivate: [editorGuard] },
  { path: "publications/:week/:version", component: PublicationPage, canActivate: [editorGuard] },
  { path: "forbidden", component: Forbidden },
  { path: "**", redirectTo: "" },
];
