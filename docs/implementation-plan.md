# 處會週報協作系統實作規畫

狀態：已整理為[實作規格](implementation-spec.md)，2026-09-28。依 [共同編輯解決方案設計](solution-design.md)、[週報架構設計](report-structure.md) 與 [決策地圖](../.scratch/weekly-report-collaboration/map.md) 展開。

## 已確認的技術與交付決策

- 前端採 Angular，參照 `D:\Projects\ums-app` 的 `template` 分支；現有範本為 Angular 21 standalone app，已具 SSO 憑證換取、refresh token、JWT interceptor 與 auth guard。新系統應在自己的路由上實際套用 guard，並將 API 指向同源後端。
- 後端採 ASP.NET Core 9，單一服務提供 API 與 Angular 靜態檔；持久資料採 SQLite，供四位編輯者共用，部署於固定內網主機並備份。
- 第一階段先交付四人共編核心：登入與授權、週報與六段章節的項目編輯、30 分鐘項目租約、私有草稿、跨週延續、不可變發布版、固定唯讀連結、投影與瀏覽器列印。
- 第一階段就以結構化欄位維護專案階段、重要里程碑、計畫基準、目前預估與實際日期，先用表單與清單呈現，並記錄基準變更原因及歷史。
- 第二階段接 eCIM 課別同步、候選差異與欄位人工覆寫，並用第一階段已保存的專案日期呈現甘特圖。eCIM 已有 HTTP API，可由後端整合，不需以 MCP 作為正式服務執行期依賴。
- 週報系統角色與課別對照存 SQLite；以 JWT 的 `empNo` 作為穩定人員鍵。`empID` 是 AD 帳號，`empName` 供顯示，不作權限鍵。
- 正式輸出採固定版號的唯讀網頁、投影模式與瀏覽器列印；PDF 由瀏覽器列印產生。
- 首次啟用時由空白建立首份週報，四位編輯者輸入首週內容。此決策遵守既有設計不包含資料遷移的範圍。
- 之後由 Guy 手動建立本週草稿，從前週最新已發布版延續；同一處會日期只能有一份工作草稿。
- 正式版讀者以 SQLite 名單授權；首次名單由部署設定匯入，後續可調整。人事內容依既有讀者權限提供。
- 內網部署先使用 UAC 的 HTTP JWKS URL 自動取得驗證公鑰。

## 已核對的整合事實

| 項目 | 目前事實 | 實作含意 |
| --- | --- | --- |
| Angular 範本 | `ums-app` 的 `template` 分支已在 `src/app/core/auth` 實作 SSO 流程；`app.routes.ts` 目前是空路由，未設後端 proxy。 | 複用登入流程時需補上應用路由保護及同源 API 設定。 |
| UAC JWT | 範例 claim 有 `empNo`、`empID`、`empName`、`authMethod`、`expire`、`exp`；未見 `sub`、`iss`、`aud`。 | 驗證簽章與 `exp`，再用 `empNo` 查本地角色；不可把缺少的 issuer/audience 當作必填。 |
| JWKS | `http://tncimweb1.cminl.oa/uacapi/.well-known/jwks.json` 已確認回傳帶 `kid` 的 RSA／RS256 簽章公鑰；JWT header 不帶 `kid`；同主機 HTTPS 443 目前拒絕連線。 | 依決策使用內網 HTTP 擷取，要求剛好一把 RSA／RS256 公鑰，拒絕帶 `kid` 的 JWT。 |
| UacApi 參考 | `ServicesConfigurator.cs` 使用 RSA 簽章驗證，關閉 issuer/audience 驗證，正式環境驗證期限，`ClockSkew=0`。 | 新後端沿用可互通的 token 契約；部署後仍驗證期限。 |
| eCIM REST | 內網 Swagger 有 `GET /Work/ReviewWork`，查詢欄位包括 `updateDateFrom`、`updateDateTo`、`userId`、`timeFrom`、`timeTo`、`division`、`dept`、`section`、`teamId`；回傳 `WorkReviewResult`。 | 第二階段建立伺服器端 eCIM client，以課別成員及期間批次讀取。 |
| 本機建置工具 | 目前可執行 .NET SDK 9.0.310 與 Node.js 24.19.0；`npm` 未出現在目前命令路徑。 | 開始 Angular 建置前需備妥 npm 或團隊指定的套件管理器。 |

## 系統切分與資料邊界

```text
瀏覽器 Angular 21
  ├─ UAC SSO：沿用 template 的憑證換取、refresh 與登出流程
  └─ 同源 /api：週報、項目、租約、草稿、發布與讀者頁
       └─ ASP.NET Core 9：每個請求驗證 JWT 與本地角色
            ├─ SQLite：工作草稿、權限、租約、私有草稿、版本、發布快照
            └─ 第二階段 eCIM HTTP client：只由後端保存呼叫憑證
```

Angular 範本目前的路由為空，且 interceptor 對所有請求附加 JWT。實作時須設定編輯／正式頁路由與 guard，讓週報 API 使用同源 `/api`；JWT 只送往本系統 API，不隨外部連結或 eCIM 來源 URL 送出。SSO 返回編輯頁時須保留 hash route 或改用可完整往返的路由方式。後端所有授權以驗證過的 `empNo` 查本地名單，前端顯示控制不作授權依據。

JWT 公鑰由固定 UAC 主機的 HTTP JWKS 取得，必須剛好有一把 RSA／RS256 公鑰，並於 API 執行期間快取；UAC 更換公鑰後重新啟動 API。只接受不帶 `kid` 的 RS256 JWT，驗證簽章與 `exp`，拒絕缺少 `empNo` 的 token。取不到 JWKS、零把或多把合格公鑰時拒絕 token 並記錄錯誤；已快取的公鑰在 API 執行期間繼續使用。由於此連線使用 HTTP，部署網段與 UAC 主機之間的網路信任是本決策的前提。

單一服務實例持有 SQLite。資料庫放於非靜態檔目錄，使用交易、唯一索引、外鍵與 WAL；寫入衝突有明確回應，不以最後寫入者覆蓋。備份包含 SQLite 一致快照及還原演練。角色／讀者名單由部署設定首次匯入；後續由受控的管理指令更新 SQLite 並留稽核，不把名單綁死在程式碼。

## 第一階段資料模型

| 資料 | 必要規則 |
| --- | --- |
| `UserAccess` | `empNo` 唯一，記錄顯示名稱、Guy／課長／讀者角色與課別；角色調整留稽核。 |
| `Report` | 處會日期唯一；由 Guy 建立，首份空白，之後從前週最新發布版延續。 |
| `ReportItem` | 穩定 `continuityId`、本週版本、章節、課別、維護人、狀態、排序與版本號；各章節使用對應欄位，不把六種項目壓成自由文字。 |
| `Project`, `Phase`, `Milestone`, `ProjectRecord` | 第一階段保存健康度、階段與里程碑的基準／預估／實際日期，以及風險、問題、相依、待決策事項；基準調整需填原因。 |
| `EditLease`, `PrivateDraft` | 同項目一個有效租約，30 分鐘到期且可續期；私有草稿僅編輯者可讀，提交前不進共用內容。 |
| `ItemRevision`, `AuditEvent`, `ScheduleRevision` | 每次提交保留操作者、時間、項目版本與變更；階段建立保存首次原始計畫，建立後每次修改保留原因及完整前後狀態。 |
| `Publication` | 報告內唯一遞增版號、建立時間、發布者與不可變快照；固定連結指向指定版號。 |
| `SourceRef` | 第一階段允許人工連結既有來源；eCIM 尚未同步時顯示「尚未連接來源」，不把它解讀為零工作。 |

發表快照在同一交易讀取一致的工作版。發布後可繼續編輯工作草稿；再次發布新增版號。下週延續保留 `continuityId` 與未結事項；本週結案項目在本週留一次摘要，下週退出正文。正式頁在後端依讀者身分提供允許內容，人事項目不靠前端隱藏。

## 第一階段 API 與畫面工作包

| 工作包 | 後端契約 | Angular 畫面／行為 | 完成條件 |
| --- | --- | --- | --- |
| A. 登入與授權 | JWT 驗證、`GET /api/me`、角色與讀者名單查詢 | SSO 回跳、路由保護、無權限頁 | 有效且列名者進入對應頁；無效 token 為 401，無權限為 403。 |
| B. 週報與章節 | `POST /api/reports`、`GET /api/reports/{id}`、項目 CRUD | 六段章節、項目卡、可收合側欄與預覽 | Guy 建立唯一週報；課長只能改所屬項目；人事草稿只對相關人員可見。 |
| C. 專案時程 | 專案、階段、里程碑與管理紀錄的項目內更新 | 日期與狀態表單、原始與目前計畫對照 | 階段寫入須有專案租約與版本；修改須記原因、完整歷史；原始資料更正獨立於一般改期。 |
| D. 協作 | `POST /api/items/{id}/lease`、續期／釋放、`PUT /api/items/{id}/private-draft`、`POST /api/items/{id}/commit` | 鎖定持有人與倒數、私有草稿狀態、衝突比較 | 同項目只有一人可提交；租約與版本雙重檢查，衝突保留私有草稿。 |
| E. 延續與發布 | `POST /api/reports/{id}/publications`、`GET /api/publications/{id}` | 上週承諾對照、Guy 發布、正式唯讀頁、投影與列印 | 版號與快照不可改；舊版可查；僅 Guy 能發布。 |

提交項目時在同一交易完成權限、租約 token、`baseVersion`、欄位驗證、版本遞增與稽核寫入。以 `409 Conflict` 回應租約占用或版本衝突並附可供比較的最新版本；已過期或無效租約不得提交。新週建立與發布請求須具備冪等處理，避免重按產生重複週報或版本。

## 第二階段工作包

1. 建立 eCIM HTTP client，呼叫 `GET /Work/ReviewWork`；依三課成員與擷取時窗配置批次取得，逐人成敗記錄。服務端憑證經部署秘密設定提供，不送往瀏覽器。
2. 將來源 Work ID、匯入批次、最新來源值與人工覆寫狀態存入 `SourceRef`／`FieldOrigin`；同一來源重匯需冪等。
3. 提供課長候選池與欄位差異：新增、合併、暫緩、忽略、維持人工值或套用來源。同步失敗保留上次成功時間；不自動改寫管理敘述及已發布版。
4. 以第一階段的 `Phase`／`Milestone` 日期資料繪製甘特圖，顯示基準、預估與實際日期；日期仍由表單修改並記錄原因。

## 驗收與交付順序

| 順序 | 可展示成果 | 核心驗收 |
| --- | --- | --- |
| 1 | Angular／.NET 9 同源骨架與 UAC 登入 | 真實 JWT 的簽章、期限、`empNo` 角色與前後端權限檢查。 |
| 2 | SQLite 六章節編輯器與專案表單 | 首份空白週報、項目權限、人事草稿限制、時程變更歷史。 |
| 3 | 四人共編 | 不同項目同時編輯；同項目排他鎖、續期、逾期衝突與私有草稿恢復。 |
| 4 | 延續、發布與正式頁 | 從前週最新發布版建立唯一草稿；固定版號、舊版查詢、投影與列印。 |
| 5 | eCIM 差異同步 | 三課獨立同步、逐人失敗提示、重匯冪等、人工值不被覆蓋。 |
| 6 | 甘特圖 | 基準與預估偏差、里程碑、歷史基準和列印可讀。 |

## 部署前需提供的設定資料

- Guy、三位課長及正式版讀者的 `empNo`、角色與課別；三課工程師的 eCIM `userId` 對照與每課擷取時窗在第二階段提供。
- 內網主機、對外 URL、服務帳號、SQLite 持久目錄、備份位置及保留天數。
- eCIM 服務端呼叫憑證與授權方式在第二階段部署前核實；Swagger 的該操作未宣告 security scheme，不能單靠 Swagger 推定匿名可用。

## 定稿確認

業務流程、第一階段範圍、資料起點、身分對照、讀者名單、專案時程、eCIM 第二階段與內網 JWKS 方式均已逐項決定。確認整體規畫後，即可依上方六個可展示成果開始拆票與實作。
