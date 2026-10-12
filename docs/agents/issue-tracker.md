# Issue tracker

本專案的票據目前保存在工作區的 `.scratch/`，沒有設定 Git 遠端 issue tracker。審查時直接讀取本地票據與其規格，不要把 `#1` 單獨當成全域唯一編號。

## 找到票據

| 票據系列 | 索引 | 票據路徑 |
| --- | --- | --- |
| 專案時程重設計 | [map](../../.scratch/project-schedule-redesign/map.md) | `.scratch/project-schedule-redesign/issues/NN-*.md` |
| 週報實作 | [map](../../.scratch/weekly-report-implementation/map.md) | `.scratch/weekly-report-implementation/issues/NN-*.md` |
| 週報協作設計 | [map](../../.scratch/weekly-report-collaboration/map.md) | `.scratch/weekly-report-collaboration/issues/NN-*.md` |
| UAC SSO 啟動與回跳流程 | [map](../../.scratch/uac-sso-initialization/map.md) | `.scratch/uac-sso-initialization/issues/NN-*.md` |
| 執行時 API 設定 | [map](../../.scratch/runtime-api-config/map.md) | `.scratch/runtime-api-config/issues/NN-*.md` |

1. 使用使用者提供的完整路徑或系列名稱與票號。檔名以兩位數編號開頭，例如「project-schedule-redesign issues #1」對應 `01-phase-schedule-and-revisions.md`。
2. 若只給 `#NN`，先查看分支名稱、提交訊息及上述索引；有多個系列符合時，請使用者指定系列，勿自行選一張票。
3. 讀取該票的 **What to build**、核取清單、阻擋票，以及索引連到的規格。審查規格符合度時以票據要求為準；相關設計文件提供背景。
4. 若提交訊息含 `#NN`，依其系列查找對應檔案。若票據檔不在工作區，明確回報缺少的路徑，不要憑編號推測內容。

目前的專案時程重設計 #1 規格位於 [專案階段與完整修訂紀錄](../../.scratch/project-schedule-redesign/issues/01-phase-schedule-and-revisions.md)。上層設計文件已取代並刪除。
