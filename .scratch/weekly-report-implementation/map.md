# 處會週報協作系統實作票據

Status: ready
Labels: ready-for-agent

規格：[處會週報協作系統規格](../../docs/implementation-spec.md)。原始規格議題：[處會週報協作系統實作規格](../weekly-report-collaboration/issues/07-implementation-spec.md)。架構決策見 `docs/adr/`。

第一階段：01–09。第二階段：10–12。各票的 `Blocked by` 僅列真正的起始前提；其餘票可並行。從沒有 blocker 的票開始，完成後再推進新開放的票。

| 票 | 標題 | 直接阻擋票 |
| --- | --- | --- |
| [01](issues/01-uac-login-first-report.md) | UAC 登入與建立首份週報 | 無 |
| [02](issues/02-item-lease-private-draft.md) | 項目編輯、租約與私有草稿 | 01 |
| [03](issues/03-edit-conflict-revisions.md) | 同項目衝突與修訂紀錄 | 02 |
| [04](issues/04-management-and-nonproject-sections.md) | 管理摘要與非專案章節 | 02 |
| [05](issues/05-structured-project-schedule.md) | 結構化專案時程 | 02 |
| [06](issues/06-personnel-and-reader-access.md) | 人事內容與正式版讀者權限 | 02 |
| [07](issues/07-immutable-publication.md) | 發布快照與固定版號連結 | 04、05、06 |
| [08](issues/08-weekly-continuation.md) | 建立下週草稿與事項延續 | 07 |
| [09](issues/09-projection-print.md) | 投影與瀏覽器列印版式 | 07 |
| [10](issues/10-ecim-section-sync.md) | eCIM 課別同步與來源狀態 | 04 |
| [11](issues/11-candidate-override.md) | 候選決策與人工覆寫保護 | 10 |
| [12](issues/12-project-gantt.md) | 專案甘特圖 | 05 |
