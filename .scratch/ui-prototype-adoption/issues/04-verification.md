---
wayfinder: grilling (HITL)
status: closed
assignee: guy.mai
---

## Question

驗收怎麼做：Playwright 煙霧測試要覆蓋哪些畫面與角色（三課課長、部級）？是否與原型截圖比對？原型的角色與畫面切換列（protobar）如何轉成可測的種子資料或 mock UAC？

## Blocked by

- 02-screens-and-routes（已關閉）

## Resolution

**「現有測試綠燈」定義**：既有單元測試、API 的 HTTP 煙霧測試、改寫後的 `tests/browser-smoke.mjs` 全過。

**角色**：維持兩個——一位課長（`H1`，第一課）加部級（`G`）。課長視角順帶驗「跨課唯讀」與「他課 rail 標唯讀」。第二、三課權限隔離由 API 層 HTTP 測試覆蓋，不重複。原型 protobar 不移植：身分由 token 決定，畫面切換走路由。

**截圖**：不做像素比對（原型是拋棄式單檔 HTML，渲染會飄）。改用結構斷言驗頂欄、rail、頁籤、健康度膠囊、狀態膠囊的文字與數量。每個畫面另存一張截圖當 artifact 供人工對照，不作為通過條件。

**固定日期**：`page.clock.setFixedTime('2026-10-12')`，與原型 TODAY 一致。fixtures 日期依此基準，至少含一個逾期項與一個曾延後項。

**選擇器契約**：現有 `data-*` 全部保留；新元素補同風格屬性：`data-shell`、`data-rail-file`、`data-tab`、`data-dirty`、`data-health`、`data-week-status`。直接改寫 `browser-smoke.mjs`，不另開新檔。CSS class 不當選擇器（既有甘特斷言除外）。

**新增覆蓋流程**（加在現有編輯／儲存／發布／版本切換之外）：
1. 深連結 `weeks/:week/:file/:tab` 直接開對應頁籤。
2. 改動後出現髒點與「● 有未儲存變更」，儲存後消失。
3. 髒狀態下換週跳離開提示。
4. 首頁週次狀態膠囊：有發布顯示「已發布 vN」，否則「草稿」。
5. 正式版專案標頭的健康度膠囊文字。

**單元測試**：健康度純函式、髒狀態快照比對。

**留給後續**：05、06 若新增可測行為，各自補進本清單。
