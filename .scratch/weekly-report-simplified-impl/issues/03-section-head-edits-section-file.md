# 03 — 課長編輯並儲存課檔

**What to build:** 第一條打通全程的切片。課長登入週報網站，打開某週的編輯頁，看到四份檔（三課與跨課），只有自己的課檔可編輯，其他唯讀。課長新增或修改非專案項目（系統維護與營運、重大系統異常、人力與組織異動、新技術評估、工程師工作附錄），按「儲存」後，網站以服務帳號把整份課檔 commit 並 push 到資料 repo。課長不接觸 git。

新路徑與舊系統並存（新路由 `weeks/:week`、新 API `/api/weeks…`），舊功能在 [09 移除舊系統](09-remove-legacy-system.md) 才刪除。

範圍：
- JSON 契約：課檔 `{ week, section, items }`、跨課檔 `{ week, managementSummary, pendingDecisions }`、發布索引。非專案項目沿用現有項目與項目細節欄位，移除 `lease`、`version`、`continuityId`、`status`（G2）。專案項目的時程欄位先定型別，編輯畫面在 04 做。
- 資料 repo：本機工作目錄由設定指定；`weeks/<週>/s1.json`、`s2.json`、`s3.json`、`cross.json`（G1）。remote 可空，空則不 push。
- 路徑安全：週次必須符合 `YYYY-Www`，檔名只接受 `s1|s2|s3|cross`；路徑完全由這兩者組成。
- 寫入：寫入前 fast-forward pull，寫入後 add/commit/push；commit 訊息含 empNo 與檔名；所有寫入以單一全域鎖串行（加 `ponytail:` 註解說明上限）。push 失敗保留本機 commit，回 500 並附 git stderr 首行。
- 權限：沿用 UAC JWT。課長只能寫自己課別的檔；部級暫以現有 `Guy` 角色代表，於 [09 移除舊系統](09-remove-legacy-system.md) 改名為 `Division`。
- 端點：`GET /api/me`、`GET /api/weeks`、`GET /api/weeks/{week}`（缺檔回空物件）、`PUT /api/weeks/{week}/{file}`（驗證為 JSON 物件、上限 1 MB、內容中的 `week`/`section` 與路徑一致）。

依據：[簡化週報實作計畫](../../../docs/simplified-weekly-report-implementation-plan.md) 切片 1、2、5；[資料 repo 與發布流程](../../weekly-report-simplified/issues/04-data-repo-and-publishing.md)；[git 寫入方式](../../weekly-report-simplified/issues/07-git-write-interface.md)。

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [x] 測試資料：一週四檔的樣本資料 repo
- [x] 課長在新編輯頁修改自己課檔的非專案項目並儲存，重新載入後內容保留
- [x] 他課課檔與跨課檔在頁面上唯讀
- [x] HTTP 煙霧測試以暫時 git repo（bare repo 當 remote）加暫時 RSA/JWKS 驗證：
  - [ ] 課長寫自己課檔成功，remote 出現對應 commit
  - [ ] 課長寫他課課檔或 `cross` 回 403
  - [ ] 非法週次、非法檔名、含 `..` 的路徑回 400
  - [ ] 內容 `week`/`section` 與路徑不符回 400
- [x] 舊系統功能與既有煙霧測試仍通過
