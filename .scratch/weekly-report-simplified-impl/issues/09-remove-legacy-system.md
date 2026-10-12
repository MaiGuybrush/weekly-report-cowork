# 09 — 移除舊系統

**What to build:** 新流程（01–08）完成後，刪除被取代的舊系統，讓週報網站只剩簡化後的功能。

刪除：
- SQLite 儲存層與套件、資料庫路徑設定。
- eCIM 用戶端、同步、候選決策、欄位來源追蹤、eCIM 設定。
- 舊的週報、項目、時程、相依、外部交付、佐證連結端點；租約、私有草稿、提案、修訂紀錄、時程變更紀錄、存取稽核與人員管理端點。
- 舊前端頁面與型別：舊編輯頁、舊正式版頁、Reader 入口與守衛（G3），以及上述功能的畫面。
- 舊煙霧測試中對應的案例；煙霧測試只留新流程。
- 舊共同編輯原型（整個 prototype 目錄）。

收尾：
- 角色改名：部級角色由 `Guy` 改為 `Division`，同步設定檔使用者名單、後端權限判斷、前端角色判斷與煙霧測試。
- README 改寫：資料 repo 工作目錄、工程師工作彙整目錄與檔名慣例、服務帳號 git 憑證放在伺服器環境、角色名單、驗證指令。
- 舊的解決方案設計與專案時程重設計規格標註「已由簡化週報解決方案規格取代」。
- CONTEXT.md 補「建立下週」等新詞彙，移除已不存在的概念。

依據：[簡化週報實作計畫](../../../docs/simplified-weekly-report-implementation-plan.md) 切片 2、5、7；[移除範圍確認](../../weekly-report-simplified/issues/02-scope-cut-list.md)；[後端語言](../../weekly-report-simplified/issues/05-backend-language.md)。

**Blocked by:** [04 專案時程編輯與甘特圖](04-project-schedule-in-section-file.md)、[05 部級編輯跨課檔](05-division-edits-cross-file.md)、[06 發布與正式版頁](06-publish-and-publication-page.md)、[07 建立下週](07-create-next-week.md)、[08 來源連結挑選](08-source-link-picker.md)

**Status:** ready-for-agent

- [x] 後端不再引用 SQLite 與 eCIM；專案檔無 SQLite 套件
- [x] 程式與設定中不再出現 `Guy` 角色，部級一律為 `Division`
- [x] prototype 目錄已刪除
- [x] 前端路由只剩首頁、週編輯頁、正式版頁、forbidden
- [x] 後端建置、前端建置、HTTP 煙霧測試、瀏覽器煙霧測試皆通過
- [x] README、舊規格標註、CONTEXT.md 已更新
