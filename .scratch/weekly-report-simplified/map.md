# 簡化週報地圖

label: `wayfinder:map`

## Destination

一份簡化版解決方案規格，取代現行的專案時程重設計與週報協作設計。規格定義三位課長各自維護課別內容、部級彙整跨課內容並發布；資料以 JSON 為來源，週報 JSON 存於另一個資料 repo；保留 Angular 前端與甘特圖元件。終點是可交付實作的規格，不含程式碼。

## Notes

- 領域：`CONTEXT.md`（詞彙表），於 grilling 時更新；新增或刪除詞彙時一併修改。
- 尚未發布，不需資料遷移。
- 已確認的方向：移除項目級鎖定與共同編輯；移除應用內修訂紀錄，版本歷史交給 git；後端保留 C#，不改寫 Python。
- 票據為本地 Markdown，阻擋關係寫於票據的 `Blocked by:` 行。

## Decisions so far

- [甘特圖輸入契約](issues/03-gantt-input-contract.md) — 甘特圖寫在 `report-app.ts` 單一檔案中，輸入為 `ScheduleEntry`；改讀 JSON 不需重寫模板，但需先拆出元件並移除修訂入口與 `history`。
- [課別與跨課內容的擁有者](issues/01-owner-data-model.md) — 每週四檔：三課各一檔加一檔跨課；單課專案在該課檔，跨課專案由指派的統整課長在其課檔中維護；移除「週報維護人」角色。
- [移除範圍確認](issues/02-scope-cut-list.md) — 時程模型與甘特圖全部保留；移除鎖定、共同編輯、修訂紀錄、時程變更紀錄與 eCIM 同步；來源連結改為手動輸入。
- [資料 repo 與發布流程](issues/04-data-repo-and-publishing.md) — 每週一個資料夾含四個 JSON；網站代為 commit 課長草稿；發布複製完整快照到 `publications/<週>/v<n>/` 並打 tag；`publications/index.json` 供前端找最新與歷史版。
- [後端語言](issues/05-backend-language.md) — 後端保留且維持 C#，不改寫 Python；職責縮為靜態檔託管、JWT 驗證、草稿 commit、發布。沿用 SSO/JWT，角色只剩課長與部級。
- [週報 JSON 結構、草稿讀取與部署](issues/06-json-shape-and-deployment.md) — 部署如現況（後端託管靜態前端）；後端讀 git 工作目錄；JSON 沿用 `ScheduleEntry` 欄位，相依只存 `predecessors`；來源連結以頂層工作項目的 `workId` 加手寫摘要為單位。
- [git 寫入方式](issues/07-git-write-interface.md) — 後端以 git CLI 在本機工作目錄執行草稿 commit 與發布 tag，服務帳號憑證由伺服器環境提供。
- [計畫／實際兩組日期](issues/08-plan-actual-two-dates.md) — 原始／目前／實際三組日期簡化為計畫與實際：欄位改 `plan*` + `actual*`、不遷移舊資料；偏差為實際 vs 計畫；甘特圖每列計畫條加實際條；取消原始資料更正流程；刪除舊設計文件並清除 `.scratch/` 引用。

## Not yet specified

（無，所有 fog 已收斂為票據。）

## Out of scope

- 實作程式碼本身（屬於規格之後的工作）。
- 資料遷移與舊的 SQLite 資料（尚未發布）。
- 共同編輯、項目級鎖定、應用內修訂紀錄（已確認移除）。
- eCIM 自動同步、候選挑選、欄位來源追蹤與人工覆寫，以及 eCIM 手動匯入（已在 [移除範圍確認](issues/02-scope-cut-list.md) 移除）。
- 時程變更紀錄（與修訂紀錄同類，歷史交給 git，見 [移除範圍確認](issues/02-scope-cut-list.md)）。
- 工程師工作彙整 JSON 的產生流程：由其他流程產生，本規格只消費該 JSON。
