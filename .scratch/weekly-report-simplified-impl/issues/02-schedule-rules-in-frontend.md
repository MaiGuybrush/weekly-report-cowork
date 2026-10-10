# 02 — 時程規則移到前端

**What to build:** 新的資料流中後端不理解時程語意，所以時程規則改由前端的單一模組負責。從現有後端移植：

- 時程前置關係的限制：同專案、不可循環、階段與其直屬子任務之間不可建立。
- 順序衝突警示，以及「前置未完成、後續已開始」的即時警示。
- 外部交付通知（逾期或未完成時顯示於已關聯的時程項目）。
- 由 `predecessors` 推導 `successors`（JSON 只存 `predecessors`）。
- 取消與重新啟用：取消時移除歸屬與相依，重新啟用改回原狀態（進行中或待達成）。

「前置項目計畫變更通知」依賴應用內歷史，**不移植**。

這是預先重構：模組先建好並自檢，暫不接到現有畫面（現有畫面仍讀舊後端算好的值）。

依據：[簡化週報實作計畫](../../../docs/simplified-weekly-report-implementation-plan.md) 切片 3；[週報 JSON 結構、草稿讀取與部署](../../weekly-report-simplified/issues/06-json-shape-and-deployment.md)。

**Blocked by:** None — can start immediately

**Status:** done

- [x] 規則模組輸入為一個專案的時程項目與外部交付，輸出含推導欄位（`successors`、警示、外部交付通知）的項目，以及驗證錯誤清單
- [x] 警示訊息文字與現有後端一致
- [x] 一個可用 `node` 直接執行的 assert 自檢，至少涵蓋：循環被拒、跨專案被拒、階段與直屬子任務被拒、順序衝突、即時警示、外部交付逾期、`successors` 推導、取消後重新啟用回到原狀態
- [x] 前端建置通過
