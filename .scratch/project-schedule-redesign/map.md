# 專案時程重設計票據

Status: ready
Labels: ready-for-agent

依據：[專案時程重設計規格](../../docs/project-schedule-redesign-spec.md)。本組票據採用該規格的「原始計畫」、「目前計畫」、「時程前置關係」及「時程變更紀錄」用語。既有實作票 05、12 描述舊時程模型；本組票據不以它們為阻擋前提。

第一階段需完成 01–09 中的時程能力；10–11 是第二階段的甘特圖與 eCIM 證據。每張票的驗收包括相應的使用者可見流程及 HTTP／瀏覽器驗證。先處理沒有阻擋票的前沿工作。

| 票 | 標題 | 直接阻擋票 |
| --- | --- | --- |
| [01](issues/01-phase-schedule-and-revisions.md) | 專案階段與完整修訂紀錄 | 無 |
| [02](issues/02-key-tasks-and-owners.md) | 關鍵任務與負責人 | 01 |
| [03](issues/03-single-day-milestones.md) | 單日重要里程碑 | 01 |
| [04](issues/04-internal-predecessors-and-warnings.md) | 專案內前置關係與警示 | 02、03 |
| [05](issues/05-cancellation-and-reactivation.md) | 取消、重新啟用與關係清理 | 04 |
| [06](issues/06-external-dependency-links.md) | 跨部門相依事項關聯 | 02、03 |
| [07](issues/07-participant-progress-proposals.md) | 參與者進度與時程提案 | 02 |
| [08](issues/08-immutable-schedule-publications.md) | 不可變的發布時程快照 | 05、06 |
| [09](issues/09-weekly-schedule-continuation.md) | 完整時程跨週延續 | 08 |
| [10](issues/10-redesigned-gantt-and-summary.md) | 重新設計專案甘特圖元件與處會摘要 | 08 |
| [11](issues/11-manual-ecim-evidence-links.md) | 手動連結 eCIM 工作證據 | 09 |
