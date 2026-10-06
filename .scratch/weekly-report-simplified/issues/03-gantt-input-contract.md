---
wayfinder: research (AFK)
status: closed
---

## Question

現有甘特圖元件的輸入資料形狀是什麼？它依賴哪些欄位（起訖日、里程碑、相依關係、狀態）？改為讀取靜態 JSON 時，需要調整哪些部分？

研究範圍：`apps/web` 中甘特圖元件的 input 型別、模板繫結，以及從 API 取得資料的服務層。

輸出：一份欄位對照表，列出元件需要的每個欄位，以及目前資料來源的對應欄位。

## Resolution

**甘特圖不是獨立元件。** 它寫在 `apps/web/src/report-app.ts`（4292 行，單一檔案）中，同時服務 `ReportEditor`（約 955 行）與 `PublicationPage`（約 3484 行）。沒有獨立的 gantt component 檔案，「保留元件」需要先從這個檔案拆出。

輸入型別為 `ScheduleEntry`（`report-app.ts:136`），欄位如下：

| 欄位 | 甘特圖用途 | 簡化後是否仍需要 |
| --- | --- | --- |
| `id`, `kind`（phase/task/milestone）, `name`, `owner`, `phaseId` | 列與層級、負責人 chip | 需要 |
| `baselineStart/End`, `forecastStart/End`, `actualStart/End` | 階段與任務的時間條 | 需要 |
| `baselineDate`, `forecastDate`, `actualDate` | 里程碑點位 | 需要 |
| `state` | 狀態 pill、已取消隱藏 | 需要 |
| `predecessors`, `successors`, `warnings` | 警示圖示與相依列 | 視 02 的移除結果 |
| `externalNotices` | 🌐 外部交付圖示 | 視 02 的移除結果 |
| `evidenceLinks` | 📎 eCIM 證據計數 | 視 02（eCIM 去留） |
| `history`, `version`, `continuityId` | 修訂表單入口（`report-app.ts:1101`） | 否，依已確認移除修訂紀錄 |

對 JSON 來源的影響：
- 目前 `ScheduleEntry` 由 API 回傳；改讀靜態 JSON 只需替換資料來源，欄位形狀可沿用，不必重寫甘特圖模板。
- 「進入修訂表單」連結（`report-app.ts:1101`）與 `history` 欄位需移除。
- 甘特圖的排序與展開邏輯（`ganttDisplayEntries`、`ganttTimeline`，約 2422–2560 行）不依賴 API，可原樣保留。

## Blocked by

（無）
