# 簡化週報實作計畫

狀態：草稿，2026-10-07。依 [簡化週報解決方案規格](simplified-weekly-report-spec.md) 與 [簡化週報地圖](../.scratch/weekly-report-simplified/map.md) 的決策撰寫。詞彙以 [CONTEXT.md](../CONTEXT.md) 為準。

## 0. 原則

- 系統尚未發布：直接刪除舊功能，不做遷移、不保留相容層。
- 先並存、最後刪：新流程開在新路由與新 API，與舊系統並存，讓每張票據都能保持建置與煙霧測試通過；舊系統在最後一張票據一次移除。票據見 `.scratch/weekly-report-simplified-impl/issues/`。
- 每個切片結束時 `dotnet build`、`pnpm --dir apps/web build`、`node tests/smoke.mjs` 皆須通過；煙霧測試隨切片改寫，不另建測試框架。
- 後端不理解時程語意，只負責身分、擁有權、檔案與 git；時程規則（循環、警示、推導）集中在前端一處。

## 1. 規格缺口的決定

地圖已定案，但以下細節規格沒有寫明，已於 2026-10-07 與使用者逐一確認。

| # | 缺口 | 決定 | 影響切片 |
| --- | --- | --- | --- |
| G1 | 課檔檔名：規格寫 `課A.json`，設定檔的課別代碼為 `s1/s2/s3` | 用 `s1.json`、`s2.json`、`s3.json`，與 `Access:Users.Section` 一致，也避開 Windows 上 git CLI 的中文路徑問題 | 1、2 |
| G2 | 課檔中非專案章節（系統維護與營運、重大系統異常、人力與組織異動、新技術評估、工程師工作附錄）的 JSON 形狀 | 沿用現有 `Item` 與 `ItemDetails` 欄位，移除 `lease`、`version`、`continuityId`、`status` | 1、5 |
| G3 | 角色只剩課長與部級，原「正式版讀者（Reader）」是否移除 | 移除。正式版只供已登入的課長與部級閱讀；之後需要讀者時再加回設定名單 | 2、5 |
| G4 | 工程師工作彙整 JSON 放在哪裡 | 放在伺服器設定目錄 `EngineerWork:Path`，不進資料 repo、不保存歷史。其他流程依現有檔名 `*_yyMMdd.json` 放入；後端取檔名日期落在該週的檔案，多個時取最新 | 2、6 |
| G5 | 誰建立下週資料夾、延續時是否清空欄位 | 部級按「建立下週」：複製最新發布快照到 `weeks/<新週>/`，原樣延續，不自動清空；未處理待決策事項的發布阻擋規則先不做 | 2、5 |
| G6 | 外部交付（🌐 圖示來源）是否留在 JSON | 留下，作為專案底下的 `externalDependencies` 陣列，時程項目以 `linkedEntryIds` 關聯 | 1、3 |

## 2. 目標架構

```
apps/api/
  Program.cs        ← 重寫，約 300–500 行：設定、JWT、靜態檔、端點
  JwtVerifier.cs    ← 保留不動
  DataRepo.cs       ← 新增：路徑白名單、讀寫檔、git CLI、全域鎖
  (刪除) Store.cs、EcimClient.cs、SQLite 套件
apps/web/src/
  report-app.ts     ← 縮減：路由、首頁、課檔編輯、跨課編輯、正式版頁
  gantt.ts          ← 拆出：甘特圖元件與 ganttDisplayEntries/ganttTimeline
  schedule-rules.ts ← 新增：推導 successors、順序衝突警示、外部交付通知、循環檢查
  auth.ts、config.ts、main.ts ← 小改（角色）
資料 repo（另一個 git repo，本機工作目錄由設定 `DataRepo:Path` 指定）
  weeks/<週>/s1.json s2.json s3.json cross.json
  publications/index.json
  publications/<週>/v<n>/s1.json s2.json s3.json cross.json
工程師工作彙整（伺服器目錄，由設定 `EngineerWork:Path` 指定，不進 git）
  CIM3_ENG_WeeklyReport_<yyMMdd>.json
```

## 3. 切片

依序執行；括號內為依賴的切片。

### 切片 1：JSON 契約與樣本資料

做什麼：
- 在 `apps/web/src/report-types.ts` 定義課檔、跨課檔、發布索引的 TypeScript 型別。
  - 課檔：`{ week, section, items: Item[] }`；專案項目帶 `owner`（實際專案負責人）、`participants`（參與課別）、`schedule: ScheduleEntry[]`、`externalDependencies`。
  - `ScheduleEntry`：沿用 `report-app.ts:136` 的欄位，移除 `history`、`version`、`continuityId`、`successors`、`warnings`、`externalNotices`（後三者由程式推導，不寫入 JSON）。`predecessors` 只存 id 陣列。
  - `evidenceLinks`：`{ workId: number; summary: string }[]`。
  - 跨課檔：`{ week, managementSummary, pendingDecisions }`。
  - 發布索引：`{ publications: { week, version, publishedAt, publishedBy, path }[] }`。
- 建立 `tests/fixtures/data-repo/`（一週四檔）與 `tests/fixtures/engineer-work/CIM3_ENG_WeeklyReport_261001.json`（取 `docs/` 樣本的縮小版），供後端與煙霧測試使用。

驗收：樣本 JSON 可被型別檢查載入（在 `pnpm build` 中引用一次即可）。

### 切片 2：後端重寫（1）

刪除（於最後一張票據「移除舊系統」執行）：`Store.cs`、`EcimClient.cs`、`Program.cs` 中所有 `/api/reports`、`/api/items`、eCIM、租約、草稿、提案、修訂、時程歷史端點與記錄型別；`.csproj` 移除 SQLite 套件；`appsettings.json` 移除 `DatabasePath`、`Ecim`。

再建：
- 設定：`DataRepo:Path`（工作目錄絕對路徑）、`DataRepo:Remote`（可空，空則不 push）、`EngineerWork:Path`（工程師工作彙整目錄）、`Access:Users`（角色 `Division` 或 `Head`，課長帶 `Section`）。
- `DataRepo.cs`：
  - 週次格式 `^\d{4}-W\d{2}$`、檔名白名單 `s1|s2|s3|cross`；所有路徑以此組成，不接受使用者給的路徑片段。
  - 以 `Process` 呼叫 `git`；寫入前 `git pull --ff-only`，寫入後 `add/commit/push`。commit 作者為服務帳號，訊息帶 empNo 與檔名。
  - 單一 `SemaphoreSlim` 串行化所有寫入。`// ponytail: global lock; one writer per file and a handful of users, revisit only if writes queue visibly`
- 端點：

| 方法與路徑 | 權限 | 行為 |
| --- | --- | --- |
| `GET /api/me` | 已登入 | 回傳 empNo、姓名、角色、課別 |
| `GET /api/weeks` | 已登入 | 列出 `weeks/` 下的週次 |
| `GET /api/weeks/{week}` | 已登入 | 回傳四檔內容（缺檔回空物件） |
| `PUT /api/weeks/{week}/{file}` | `s1–s3`：該課課長；`cross`：部級 | 驗證為 JSON 物件、大小上限 1 MB、`week`/`section` 與路徑一致；寫檔、commit、push |
| `POST /api/weeks` | 部級 | 建立下週：複製最新發布快照（無快照則空檔）到 `weeks/<新週>/`，commit |
| `POST /api/weeks/{week}/publications` | 部級 | 版號 = 該週既有最大版號 + 1；複製四檔到 `publications/<週>/v<n>/`；更新 `index.json`；commit；tag `pub/<週>-v<n>`；push（含 tag） |
| `GET /api/publications` | 已登入 | 回傳 `index.json` |
| `GET /api/publications/{week}/{version}` | 已登入 | 回傳該快照四檔 |
| `GET /api/weeks/{week}/engineer-work` | 課長、部級 | 從 `EngineerWork:Path` 找檔名日期落在該週的 `*_yyMMdd.json`（多個取最新），唯讀回傳；無檔回 404 |

- 靜態檔託管與 `index.html` fallback 照現有 `Program.cs:22-36` 與 `:1657` 保留。
- 錯誤處理：git 指令非零結束時回 500，訊息含 stderr 首行；push 失敗時保留本機 commit，不回滾檔案（下次寫入會再 push）。

驗收：改寫 `tests/smoke.mjs`，以暫時 git repo（`git init --bare` 當 remote）加暫時 RSA/JWKS 驗證：
- 課長只能寫自己的課檔，寫他課與 `cross` 回 403；部級可寫 `cross`、不可寫課檔。
- 非法週次或檔名回 400（含 `..`）。
- 寫入後 remote 有對應 commit。
- 發布兩次產生 `v1`、`v2`、兩個 tag，`index.json` 兩筆；發布後修改草稿不影響快照。
- 建立下週複製最新快照內容。
- 工程師工作彙整依週次取到正確檔案；該週無檔回 404。

### 切片 3：時程規則移到前端（1）

- 新增 `schedule-rules.ts`，從 `Program.cs` 移植：
  - `HasDependencyCycle`（`Program.cs:1961`）與前置關係的限制（同專案、不可為階段與其直屬子任務、不可循環）。
  - 順序衝突警示與「前置未完成但後續已開始」即時警示（`Program.cs:2259-2292`）。
  - 外部交付通知（`Program.cs:2296-2325`）。
  - 由 `predecessors` 推導 `successors`。
  - 取消與重新啟用：取消時移除歸屬與相依（沿用現行語意），重新啟用改回原狀態（`in-progress` 或 `pending`）。
- 「前置項目計畫變更通知」（`Program.cs:1991`）依賴變更歷史，歷史已交給 git，**不移植**。
- 檢查：`schedule-rules.ts` 底部加一個 `node` 可執行的 assert 自檢（或在 `tests/` 加 `schedule-rules.test.mjs`），涵蓋循環、衝突、即時警示、外部逾期各一例。

### 切片 4：甘特圖拆出（1、3）

- 從 `report-app.ts` 拆出 `gantt.ts` 獨立元件：輸入 `entries: ScheduleEntry[]`（已含推導欄位）、`externalDependencies`；輸出 `entrySelected`。
- 一併搬走 `ganttDisplayEntries`、`ganttTimeline`（約 `report-app.ts:2422-2560`），保留全部既有互動（展開全部關鍵任務、逐階段收合、顯示/隱藏已取消、圖例、今日線、tooltip、📎/⚠/🌐）。
- 移除修訂表單入口（`report-app.ts:1101`）與 `history` 相關模板。
- 📎 計數改讀 `evidenceLinks.length`。

驗收：`ReportEditor` 與 `PublicationPage` 都改用 `<app-gantt>`，畫面與現況一致（以 `tests/browser-smoke.mjs` 截圖比對一個專案）。

### 切片 5：前端改接新 API（2、4）

刪除（於最後一張票據「移除舊系統」執行）：租約、私有草稿、提案、eCIM 同步與候選、欄位來源、修訂紀錄、時程變更紀錄、存取稽核與人員管理畫面及其型別；`ReaderEntrance` 與 `readerGuard`（依 G3）。

再建：
- 路由：`""` 首頁（週次清單、部級的「建立下週」）、`weeks/:week` 編輯頁、`publications/:week/:version` 正式版頁。
- 編輯頁：
  - 課長看到四檔，只有自己的課檔可編輯，其他唯讀。部級只可編輯 `cross`。
  - 整份課檔在前端記憶體中編輯，按「儲存」整檔 `PUT`。儲存前跑 `schedule-rules.ts` 的驗證，不通過不送出。
  - 跨課專案：顯示在統整課長的課檔中；專案卡顯示參與課別。
- 正式版頁：讀 `GET /api/publications` 取得最新版與歷史版清單，切換版本時讀快照四檔。
- 發布：部級在編輯頁按「發布」，成功後導向新版本的正式版頁。
- `auth.ts`：角色判斷改為 `Division`/`Head`。

驗收：改寫 `tests/browser-smoke.mjs`：課長登入、編輯專案時程、儲存；部級發布；正式版頁顯示新版本。

### 切片 6：來源連結（2、5）

- 時程項目的 📎 編輯面板：從 `GET /api/weeks/{week}/engineer-work` 列出頂層 `items`（`workId`、`workContent`、`ownerName`、`status`），課長勾選並填摘要，存為 `evidenceLinks`。
- 子項目不單獨挑選，只在選中項目下方顯示供撰寫摘要參考。
- 工程師工作彙整不存在時，面板仍可手動輸入 `workId` 與摘要。

驗收：煙霧測試挑選一筆並儲存，重新載入後 📎 計數正確。

### 切片 7：文件收尾（2–6）

- `README.md` 改寫：設定 `DataRepo:Path`、`EngineerWork:Path` 與檔名慣例、服務帳號 git 憑證放在伺服器環境（credential helper 或 SSH key）、角色名單。
- 舊設計文件（共同編輯解決方案設計、專案時程重設計規格等）已由簡化週報解決方案規格取代並刪除。
- `CONTEXT.md` 依 G1–G6 的最終決定補詞彙（例如「建立下週」）。
- 刪除 `prototype/`（舊共同編輯原型）。
- 部級角色由 `Guy` 改為 `Division`（設定、後端、前端、測試）。

## 4. 依賴圖

```
1 ─┬─ 2 ─────────┬─ 5 ─ 6 ─ 7
   └─ 3 ─ 4 ─────┘
```

切片 2 與 3→4 可平行進行。

## 5. 不做的事

- 前置項目計畫變更通知（依賴應用內歷史，已移除）。
- 儲存時的樂觀鎖或衝突合併：每個檔只有一位寫入者。
- 後端的時程語意驗證：後端只驗證擁有權、路徑與 JSON 形狀，時程規則只在前端。若日後出現非網站的寫入來源，再把 `schedule-rules` 搬到共用驗證。
- 未處理待決策事項的發布阻擋（G5）。
