# 06 — 發布與正式版頁

**What to build:** 部級在編輯頁按「發布」，系統把該週四份檔複製為不可變的發布快照，版號為該週既有最大版號加一；更新發布索引；commit；打 tag `pub/<週>-v<n>`；push（含 tag）。成功後導向新版本的正式版頁。

正式版頁只讀發布索引：預設顯示最新版（最新週次中版號最高的一筆），可切換到任何歷史版；內容含各課項目、跨課內容與專案甘特圖（唯讀）。發布後草稿仍可繼續編輯並重新發布。

閱讀權限：已登入的課長與部級（Reader 角色已移除，G3）。

端點：`POST /api/weeks/{week}/publications`（部級）、`GET /api/publications`、`GET /api/publications/{week}/{version}`。

依據：[簡化週報實作計畫](../../../docs/simplified-weekly-report-implementation-plan.md) 切片 2、5；[資料 repo 與發布流程](../../weekly-report-simplified/issues/04-data-repo-and-publishing.md)。

**Blocked by:** [01 拆出甘特圖元件](01-extract-gantt-component.md)、[03 課長編輯並儲存課檔](03-section-head-edits-section-file.md)

**Status:** ready-for-agent

- [x] 只有部級可發布；課長發布回 403
- [x] 正式版頁可切換最新版與歷史版，甘特圖唯讀顯示
- [x] HTTP 煙霧測試：
  - [ ] 同週發布兩次，產生 `v1`、`v2` 兩份快照、兩個 tag，索引兩筆（週次、版號、發布時間、發布人、快照路徑）
  - [ ] 發布後修改草稿，既有快照內容不變
  - [ ] remote 上有發布 commit 與 tag
- [x] 瀏覽器煙霧測試：部級發布後看到新版本的正式版頁
