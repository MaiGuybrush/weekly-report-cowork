---
wayfinder: grilling (HITL)
status: closed
assignee: guybr
---

## Question

收斂地圖 Not yet specified 中的四條：週報 JSON 結構、課長草稿讀取方式、工程師工作彙整 JSON 與來源連結的挑選單位、部署方式。

## Resolution

- **部署方式**：如現況。後端同一程序託管靜態前端（`UseDefaultFiles`/`UseStaticFiles` 加 fallback 到 `index.html`）。
- **草稿讀取**：後端讀 git 工作目錄（資料 repo 的本機工作複本）。
- **工程師工作彙整 JSON**：樣本為 `docs/CIM3_ENG_WeeklyReport_261001.json`。頂層含兩段期間（`s1_*`、`s2_*`）、工時（`*_t_*`）、`today_str`、`results`（以帳號為鍵，18 人、79 筆頂層項目）。每筆項目含 `workId`、`workContent`、`status`、`dueDate`、`ownerName`、`ownerId`、`percentage`、`spentTime`、`subItems` 等欄位；子項目欄位與父項目相同。
- **來源連結挑選單位**：以頂層 item 為單位。課長挑選後存 `workId` 與手寫摘要；子項目不單獨挑選，只在摘要中提及。
- **週報 JSON 結構**：
  - 專案、里程碑、階段、關鍵任務沿用甘特既有的 `ScheduleEntry` 欄位，移除 `history`、`version`、`continuityId`。
  - `evidenceLinks` 改為課長手填。
  - 取消保留於 JSON 中，沿用 `state`，重新啟用改回原狀態。
  - 相依關係只存 `predecessors`，`successors` 由程式推導，不寫入 JSON。

## Blocked by

（無）
