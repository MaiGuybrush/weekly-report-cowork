# 04 — 專案關鍵任務挑選

**What to build:** 課長在專案頁籤挑選工程師工作建立關鍵任務：先選目標專案與階段，名稱預填工作內容、負責人預填工程師姓名，計畫起迄只取工程師的 `planStartDate`/`planEndDate`（缺值時必填提示，不用 `dueDate`）。專案任務只顯示被選的那一項、不顯示子工作，以 `workId` 追蹤。關鍵任務改為單一 `workId`，移除原本的多筆 `evidenceLinks`（系統尚未發布，無遷移）；甘特圖原 📎 計數改為是否已綁定。決定理由見 [ADR 0004](../../../docs/adr/0004-single-workid-binding-with-auto-sync.md)。

**Blocked by:** 03

**Status:** ready-for-agent

- [ ] 單元測試：預填規則與缺日期必填；`workId` 唯一性涵蓋專案任務與非專案項目共用
- [ ] 課長挑選工作建立關鍵任務，歸屬所選專案與階段，儲存後重新載入仍在
- [ ] JSON 寫入白名單不再含 `evidenceLinks`；舊資料與舊發布快照仍可顯示
- [ ] 專案時程與甘特圖顯示已綁定標示，順序與相依規則不受影響
