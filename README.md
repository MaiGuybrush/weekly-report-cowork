# 處會週報共同編輯

依[簡化週報解決方案規格](docs/simplified-weekly-report-spec.md)建置的處會週報網站。週報內容以 JSON 存放於資料 repo，課長編輯自己的課檔，部級編輯跨課內容並發布不可變的正式版；另可從上週正式版建立下週，並從工程師工作彙整挑選來源連結。

## 建置與啟動

首次使用時，在專案根目錄還原 API 與 Web 相依：

```powershell
dotnet restore apps/api/WeeklyReport.Api.csproj --configfile NuGet.Config
pnpm --dir apps/web install
```

開發模式請分別啟動 API 與 Angular 開發伺服器：

```powershell
# 終端機 1：API
dotnet run --project apps/api/WeeklyReport.Api.csproj --no-launch-profile --urls http://localhost:5080

# 終端機 2：Web
pnpm --dir apps/web start
```

開啟 `http://localhost:4200`。瀏覽器會讀取 `apps/web/src/assets/config.json`，直接連接其中的 API URL；
開發伺服器不轉送 `/api`。跨來源部署時，請在 API 的 `Cors:AllowedOrigins` 明確列出 Web 來源，
UAC 服務也必須允許 Web 來源的跨來源請求。

前端建置會把設定複製到 `/assets/config.json`。部署同一份建置到不同環境時，只需替換該 JSON 中的
`apiBaseUrl` 與 `uacBaseUrl`；例如 `apiBaseUrl` 設為 `https://api.example.internal`。
同源部署可將 `apiBaseUrl` 設為空字串，使用相對 `/api`。設定缺失或無效會阻止前端啟動；
JSON 為公開檔案，不可放入密鑰。設定檔應以 `Cache-Control: no-cache` 提供，讓使用者重新整理後取得新值；
本專案 API 提供前端靜態檔時已設定此回應標頭。HTTPS 網站的 API 與 UAC URL 也必須使用 HTTPS。

部署為單一同源站點時，先建置 Web，再啟動 API；API 會提供 `apps/web/dist/weekly-report-web/browser` 內的靜態檔：

```powershell
pnpm --dir apps/web build
dotnet run --project apps/api/WeeklyReport.Api.csproj --no-launch-profile --urls http://localhost:5080
```

## 設定

需求：.NET SDK 9、Node.js 20.19 以上、pnpm、git、可連到 UAC 的內網環境。

API 設定位於 `apps/api/appsettings.json`（可用環境變數覆寫，例如 `DataRepo__Path`）：

- `JwksUrl`：UAC 的 JWKS 位址，用於驗證 JWT 並取得 `empNo`。
- `Access:Users`：角色名單。部級主管 `Role` 為 `Division`；三位課長 `Role` 為 `Head`，並需指定 `Section`（`s1`、`s2`、`s3`）。名單外的帳號一律回 403。
- `DataRepo:Path`：資料 repo 的本機工作目錄（內含 `weeks/<週>/{s1,s2,s3,cross}.json` 與 `publications/`）。目錄尚未是 git repo 時，若設定 `DataRepo:Remote` 會自動 clone，否則 `git init`。
- `DataRepo:Remote`：選用，資料 repo 的遠端；設定後每次儲存、發布與建立下週都會 push。
- `EngineerWork:Path`：工程師工作彙整目錄，位於資料 repo 之外。檔名需以 `_yyMMdd.json` 結尾（例如 `CIM3_ENG_WeeklyReport_261001.json`）；週報取檔名日期落在該週的最新一份。
- `Cors:AllowedOrigins`：跨來源部署時列出 Web 來源。

服務帳號的 git 憑證（SSH 金鑰或 credential helper）放在伺服器環境，由執行 API 的帳號持有，不放入設定檔或 repo；課長不直接接觸 git。

## 使用方式

登入後，系統依 UAC JWT 中的 `empNo` 對應角色名單。

- **部級（Division）**：編輯跨課內容（管理摘要與需決策事項）、發布正式版、建立下週。每次發布在 `publications/<週>/v<n>/` 產生不可變快照，並更新發布索引與 git tag。
- **課長（Head）**：只能編輯自己課別的課檔，包含一般項目與專案時程（階段、關鍵任務、里程碑、甘特圖），並可從工程師工作彙整挑選工作項目作為來源連結。
- 已無唯讀 Reader 角色；名單外帳號（含舊讀者）一律回 403。
- 兩種角色都可開啟任一週的編輯頁與正式版頁；歷史由 git 保存。

UAC 登入需企業內網與可用的 `CertificateKey` 或 refresh token。

## 驗證

```powershell
dotnet build apps/api/WeeklyReport.Api.csproj
pnpm --dir apps/web build
node tests/gantt-model.test.mjs
node tests/schedule-rules.test.mjs
node tests/smoke.mjs
node tests/browser-smoke.mjs
```

HTTP 煙霧測試以暫時 RSA 金鑰、JWKS 服務與暫存 git repo 驗證簽章、角色、課檔寫入權限、發布與建立下週。瀏覽器測試以模擬 UAC 服務驗證 SSO 回跳、編輯、儲存、發布與正式版頁；需先完成 Angular 建置並安裝 Playwright 和 Chrome。正式內網 UAC 仍需部署環境驗收。
