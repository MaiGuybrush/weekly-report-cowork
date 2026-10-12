# 07 — 建立下週

**What to build:** 部級在首頁按「建立下週」，系統把最新發布快照的四份檔原樣複製到新週的草稿資料夾並 commit（G5）。不自動清空任何欄位。尚無任何發布時建立空檔。首頁列出所有週次，可進入各週編輯頁。

未處理待決策事項的發布阻擋規則不在此做。

端點：`POST /api/weeks`（部級）。

依據：[簡化週報實作計畫](../../../docs/simplified-weekly-report-implementation-plan.md) 切片 2、5；[資料 repo 與發布流程](../../weekly-report-simplified/issues/04-data-repo-and-publishing.md)。

**Blocked by:** [06 發布與正式版頁](06-publish-and-publication-page.md)

**Status:** ready-for-agent

- [x] 只有部級可建立下週；課長回 403
- [x] 新週草稿內容等於最新發布快照
- [x] 新週已存在時回 409，不覆寫
- [x] 無任何發布時建立四份空檔
- [x] HTTP 煙霧測試涵蓋以上情況
