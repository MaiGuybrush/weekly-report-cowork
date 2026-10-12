# 05 — 部級編輯跨課檔

**What to build:** 部級主管在新編輯頁編輯跨課檔（本週管理摘要與待決策事項）並儲存，網站以服務帳號 commit 到資料 repo。課長看到跨課檔為唯讀。部級不可寫任何課檔。

依據：[簡化週報實作計畫](../../../docs/simplified-weekly-report-implementation-plan.md) 切片 5；[課別與跨課內容的擁有者](../../weekly-report-simplified/issues/01-owner-data-model.md)。

**Blocked by:** [03 課長編輯並儲存課檔](03-section-head-edits-section-file.md)

**Status:** ready-for-agent

- [x] 部級可編輯並儲存本週管理摘要與待決策事項，重新載入後內容保留
- [x] 課長登入時跨課檔唯讀
- [x] HTTP 煙霧測試：部級寫 `cross` 成功；部級寫任一課檔回 403
