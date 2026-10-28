---
wayfinder: grilling (HITL)
status: closed
---

## Question

元件怎麼拆（`report-app.ts`、`week-editor.ts`、`gantt.ts`、`project-schedule.ts` 的邊界）、原型 CSS（色彩 token、字型、版面）放在全域 `styles.css` 還是元件樣式？原型甘特圖多出的今日線、tooltip、逾期紅色、進行中條紋、取消線，與現有 `gantt.ts`／`gantt-model.ts` 差多少？

## Blocked by

- 02-screens-and-routes（畫面邊界決定後才能定元件邊界）

## Resolution

**樣式**
- 全部進全域 `styles.css`：整檔改寫為原型 token（`--steel`／`--amber`／`--red`／`--ok`、`--num`／`--txt` 字型），舊規則刪除；不用元件內 `styles`。

**元件邊界**（每元件一檔，`report-app.ts` 只留 `App`）
- `Shell`（頂欄＋週膠囊＋`router-outlet`；`Forbidden` 放其旁）
- `Home`（移出 `report-app.ts`）
- `WeekEditor`：rail＋路由＋固定儲存列＋髒狀態＋發布
- `FileView`：單課頁籤與專案／人事／其他區段表單
- `CrossEditor`：管理摘要＋待決策事項
- `ProjectSchedule`、`Gantt` 保留
- `ProjectHeader`（標題、負責人、參與課別、健康度膠囊）：由 `PublicationPage` 拆出，編輯頁共用
- 健康度純函式放新檔 `project-health.ts`（與 `gantt-model.ts` 並列），附單元測試

**甘特圖**
- 現有已有：今日線、里程碑菱形、取消列淡化／刪除線、原生 `title` tooltip。
- 要補：逾期紅（`late`）與進行中條紋（`running`）——`gantt-model.ts` 加判斷（計畫結束日對今天）、純樣式 class；今日標籤膠囊套樣式。
- tooltip 保留原生 `title`（`ganttTooltip`），浮動 tooltip 本輪不做（避免鍵盤／a11y 負債）。

**切票順序**
- 先「純拆元件、行為不變」（現有測試綠燈即驗收），再換視覺與路由。
