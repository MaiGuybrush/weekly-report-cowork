# 簡化週報解決方案規格

狀態：草稿，2026-10-06。依 [簡化週報地圖](../.scratch/weekly-report-simplified/map.md) 撰寫。已確定的決定附上票據連結；尚未決定的部分列於文末「未決事項」，地圖定案後才視為完成。詞彙以 [CONTEXT.md](../CONTEXT.md) 為準。

已取代並刪除舊的共同編輯解決方案設計與專案時程重設計規格。

## 1. 目標與邊界

三位課長各自維護所屬課別的週報內容，部級主管彙整跨課內容並發布。資料以 JSON 為來源，週報 JSON 存於獨立的資料 repo。保留 Angular 前端與甘特圖元件。

範圍內：時程模型（階段、關鍵任務、重要里程碑、相依關係、取消與重新啟用）與甘特圖全部保留（[移除範圍確認](../.scratch/weekly-report-simplified/issues/02-scope-cut-list.md)）。

範圍外（已移除）：項目級鎖定、共同編輯、應用內修訂紀錄、時程變更紀錄、eCIM 自動與手動同步、候選挑選、欄位來源追蹤與人工覆寫。歷史改由 git 保存。來源連結改為課長手動輸入，不從 eCIM 預填。

不含實作程式碼，也不含既有資料的遷移（系統尚未發布）。

## 2. 角色與擁有權

| 角色 | 權限 |
| --- | --- |
| 課長（一、二、三課） | 編輯自己課別的課檔；可挑選工程師工作彙整中的項目作為來源連結。 |
| 統整課長 | 跨課專案指派給參與課長之一，在其課檔中維護該專案的內容與時程。 |
| 部級主管（發布人） | 編輯跨課檔（本週管理摘要與待決策事項），並執行發布。 |

「週報維護人」角色已移除，專案只保留「實際專案負責人」作為交付責任欄位（[課別與跨課內容的擁有者](../.scratch/weekly-report-simplified/issues/01-owner-data-model.md)）。

## 3. 資料 repo 與發布

### 3.1 目錄結構

每週一個資料夾，內含四個檔（[資料 repo 與發布流程](../.scratch/weekly-report-simplified/issues/04-data-repo-and-publishing.md)）：

```
weeks/2026-W41/
  課A.json
  課B.json
  課C.json
  cross.json
publications/
  index.json
  2026-W41/
    v1/          ← 四個完整 JSON 的複本，不可變
```

### 3.2 草稿

課長在週報網站儲存時，網站以服務帳號將該課的 JSON commit 到資料 repo。課長不直接接觸 git。每位課長只寫自己的課檔，跨課檔只由部級寫入。

### 3.3 發布

發布人執行發布時：

1. 複製 `weeks/<週>/` 下四個 JSON 到 `publications/<週>/v<n>/`，版號 n 為該週已發布版號加一。
2. 快照不可變，發布後仍可在 `weeks/` 繼續編輯並重新發布（產生新版）。
3. 打 git tag `pub/<週>-v<n>` 作為索引。
4. 更新 `publications/index.json`。

下週草稿從最新快照延續。

### 3.4 發布索引

`publications/index.json` 記錄每週每一版的週次、版號、發布時間、發布人與快照路徑。前端只讀此檔。「最新版」為最新週次中版號最高的一筆。只有發布動作會更新此檔。

## 4. 已定事項

以下事項原為未決，地圖已全部定案：

- 後端：保留 C#，不改寫 Python。職責為靜態檔託管、JWT 驗證（沿用 `JwtVerifier.cs`，RS256 對 UAC JWKS 驗證，取得 empNo）、草稿 git commit、發布。角色只剩課長與部級（[後端語言](../.scratch/weekly-report-simplified/issues/05-backend-language.md)）。
- 部署：如現況，後端同一程序託管靜態前端，未知路徑 fallback 至 `index.html`。
- 草稿讀取與 git 寫入：後端讀資料 repo 的本機工作目錄，以 git CLI 執行 `add/commit/tag/push`，服務帳號憑證由伺服器環境提供（[git 寫入方式](../.scratch/weekly-report-simplified/issues/07-git-write-interface.md)）。
- 週報 JSON 結構：專案、里程碑、階段、關鍵任務沿用 `ScheduleEntry` 欄位，移除 `history`、`version`、`continuityId`；`evidenceLinks` 改為課長手填；取消沿用 `state`，重新啟用改回原狀態；相依只存 `predecessors`，`successors` 由程式推導（[JSON 結構與部署](../.scratch/weekly-report-simplified/issues/06-json-shape-and-deployment.md)）。
- 工程師工作彙整 JSON：來源連結以頂層項目的 `workId` 為挑選單位，課長存 `workId` 與手寫摘要；子項目不單獨挑選，僅於摘要中提及（06）。
