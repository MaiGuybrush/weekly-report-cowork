# 原型 UI 套用地圖

label: `wayfinder:map`

## Destination

一份「UI 套用規格」：逐畫面列出 `proto-types/weekly-report-ui.html` 與現有 Angular 前端（`apps/web/src`）的差異與要做的改動，可交給 `/to-spec`、`/to-tickets`。不含程式碼。視覺全套採用原型；套用時順便拆分元件；驗收為現有測試綠燈加 Playwright 煙霧測試。

成果：[spec.md](spec.md)（triage: ready-for-agent）。

## Notes

- 原型是拋棄式單檔 HTML，只當 primary source，需先 commit 到 `prototype/weekly-report-ui` branch 再被票據引用。
- 領域詞彙：`CONTEXT.md`；資料規格：`docs/simplified-weekly-report-spec.md`。原型超出規格的功能（待決策事項、交接／影響／下一步欄位、管理摘要）須逐項判斷是否納入。
- 票據為本地 Markdown，阻擋關係寫於票據的 `Blocked by:` 行。
- 前一個 effort：`.scratch/weekly-report-simplified/`（簡化規格，已收斂）。

## Decisions so far

- [01-data-mapping](issues/01-data-mapping.md) — JSON 不動、UI 轉接；保留 externalDependencies／evidenceLinks／sourceLinks；捨棄 previousCommitment 與單項 pendingDecision 顯示；待決策只留跨課清單
- [02-screens-and-routes](issues/02-screens-and-routes.md) — shell＋頂欄；編輯頁 rail／頁籤做成路由 `weeks/:week/:file/:tab`；髒狀態比對快照＋離開提示；首頁狀態只由 publications 推得；正式版單欄文件、共用健康度函式；預覽正式版不做
- [03-components-and-styles](issues/03-components-and-styles.md) — 樣式全進全域 styles.css 改原型 token；拆 Shell／Home／WeekEditor／FileView／CrossEditor／ProjectHeader；project-health.ts 共用；甘特補逾期／條紋、tooltip 保留 title；先純拆再換視覺

- [04-verification](issues/04-verification.md) — 綠燈＝單元＋API HTTP＋改寫後 browser-smoke；角色 H1＋G；不做像素比對只存截圖；`page.clock` 固定 2026-10-12；`data-*` 為測試契約並補新屬性；新增五項流程覆蓋
- [05-unprototyped-states](issues/05-unprototyped-states.md) — 載入中最小文字；儲存失敗顯示於固定儲存列並保留草稿；forbidden／401／啟動錯誤行為不變只換卡片；統一虛線空狀態；僅 860px 斷點；只支援正式版列印；a11y 以原型為基準補 tab／aria
- [06-retained-data-placement](issues/06-retained-data-placement.md) — 外部交付＝時程明細下第二個 details＋正式版唯讀簡表；📎 沿用列尾按鈕＋面板；sourceLinks 本輪補分項卡片底部編輯列表＋正式版可點連結
- [07-publish-flow-ui](issues/07-publish-flow-ui.md) — 發布前 `<dialog>` 確認；部級跨課檔髒時停用發布；各課無資料不擋；發布中停用鈕、失敗顯示於儲存列；版本下拉依週 optgroup、非最新版加「舊版」膠囊

## Not yet specified

- 發布前「預覽正式版」（草稿渲染來源與路由），02 決議本輪不做。

## Out of scope

- 後端、API、JSON 結構變更（屬 `weekly-report-simplified` 範圍）；若原型需要新欄位，在資料對應票據裡列為「缺口」而非在此實作。
- 程式碼實作本身。
