# 09 — 空狀態、可及性收尾與煙霧測試整併

**What to build:** 統一虛線框空狀態（有權限者顯示「新增專案」）；補 `:focus-visible`、`prefers-reduced-motion`、`aria-label` 與 `role`（`status`／`alert`）；僅 860px 斷點，確認無橫向捲軸且 rail 可用。改寫後的 `browser-smoke` 補齊 spec 所列全部流程，每個畫面另存一張截圖作 artifact（不作通過條件）。

**Blocked by:** 08 正式版文件、發布流程與版本下拉

**Status:** done

- [x] 煙霧測試涵蓋 spec 列出的五項新增流程與其他補充流程
- [x] 每畫面存一張截圖
- [x] 既有單元、API HTTP、`browser-smoke` 全綠
- [x] 窄螢幕手動看一次並記錄結果

**窄螢幕手動結果（800px）：** 無橫向捲軸（smoke 已斷言）；rail 轉為橫排可切課。發現並修正 `.rail` 固定高度與 `.edit` 兩列均分造成約 250px 空白。截圖存 `tests/screenshots/`（已 gitignore）。
