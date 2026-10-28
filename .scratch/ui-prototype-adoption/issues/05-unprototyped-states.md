---
wayfinder: grilling (HITL)
status: closed
---

## Question

原型沒有的狀態怎麼處理：載入中、錯誤、無權限、空週、草稿儲存失敗、窄螢幕與列印（原型只有一組 media query）、鍵盤與可及性？哪些沿用現有行為，哪些要補設計？

## Blocked by

- 02-screens-and-routes

## Resolution

**載入中**：補最小版。內容區顯示「載入中…」（`role="status"`），不做骨架屏；頂欄與 rail 先渲染。

**儲存／發布失敗**：失敗訊息顯示在固定儲存列內（`role="alert"`），持續到下次儲存或編輯；草稿與髒點保留不清空。成功才用 toast。時程錯誤「未儲存」沿用同位置，並標出有錯的專案。

**無權限／登入過期／啟動失敗**：行為不變（`/forbidden`、401 重新驗證、`main.ts` 啟動錯誤）。`/forbidden` 與啟動錯誤頁只換原型 token 的置中卡片（不含 shell）。路由帶不存在的週或課別時，導回首頁並 toast「找不到該週」。

**空狀態**：統一虛線框樣式（沿用 `.proposals-empty-state` 風格改 token）。文字說明＋有權限者顯示「新增專案」。首頁無正式版時大卡片換「尚無正式版」。正式版中無內容的課略過標題。

**窄螢幕**：只採原型 860px 斷點；保證無橫向捲軸、rail 可用；不另做手機設計，不列入 Playwright 驗收，手動看一次。

**列印**：只支援正式版頁。原型規則＋保留現有 `@page` 邊距；確認健康度膠囊與甘特條紋印得出來。舊兩段 print 規則合併後刪除；編輯頁不保證列印。

**鍵盤／可及性**：以原型的 `:focus-visible`、`prefers-reduced-motion`、`aria-label` 為基準，再補：rail／頁籤用 `role="tablist"/"tab"` 與 `aria-current`／`aria-selected`；髒點 `aria-label="有未儲存變更"`；離開提示對話框可 Esc。不做完整 WCAG 稽核；Playwright 只驗 Tab 能到儲存鈕。
