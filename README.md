# 處會週報共同編輯

依 [實作規格](docs/implementation-spec.md) 建置的處會週報工作區。已具備 UAC JWT 身分驗證、按課別共編、私有草稿與租約、結構化專案時程與甘特圖、人事權限、不可變發布版、跨週延續、正式讀者入口，以及 eCIM 課別同步與候選決策。

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

開啟 `http://localhost:4200`。開發伺服器會把 `/api` 轉送到 `http://localhost:5080`。

若 Web 與 API 部署在不同的主機或連接埠，請在部署前設定 `apps/web/src/index.html` 的
`weekly-report-api-base-url` meta 標籤，例如 `content="http://api.example.internal:5080"`。
保留空字串則使用同源 `/api`（也相容開發 proxy）。跨來源部署時，API 也必須允許 Web
來源的 CORS 請求。

部署為單一同源站點時，先建置 Web，再啟動 API；API 會提供 `apps/web/dist/weekly-report-web/browser` 內的靜態檔：

```powershell
pnpm --dir apps/web build
dotnet run --project apps/api/WeeklyReport.Api.csproj --no-launch-profile --urls http://localhost:5080
```

## 設定

需求：.NET SDK 9、Node.js 20.19 以上、pnpm、可連到 UAC 的內網環境。

API 從 `apps/api/appsettings.json` 讀取 `JwksUrl` 與 `DatabasePath`。`Access:Users` 需在首次啟動前設定 Guy、三位課長與正式版讀者的 `EmpNo`、`Name`、`Role` (`Guy`、`Head` 或 `Reader`)；課長另需 `Section`（例如 `s1`、`s2`、`s3`）。項目的 `section` 是六段報告章節，`ownerSection` 是可編輯該項目的課別，兩者彼此獨立。讀者無編輯頁權限。設定會於首次啟動匯入 SQLite；既有帳號不會因修改設定檔而覆寫，後續名單由 Guy 的受控 API 調整並留稽核。

人事項目以生效日期、交接、影響、下一步四欄保存；一般項目可附多個來源 URL 與待決策事項。下週草稿保留來源與上週承諾；未解待決事項在新週發布前須填決策結果或新期限。

`DatabasePath` 預設在 API 工作目錄的 `weekly-report.db`。正式部署時請設為持久磁碟上的絕對路徑。資料庫以 `CREATE TABLE IF NOT EXISTS` 建立初始結構；保存正式資料前需加入 migration 和備份流程。

eCIM 同步設定在 `Ecim`：`BaseUrl`、選用的 `ReviewWorkPath` 與每位工程師的 `Members` 設定。每筆成員設定需包含 `Section`、`UserId`、`UpdateDateFrom`、`UpdateDateTo`，並可附上 `TimeFrom`、`TimeTo`、`Division`、`Dept`、`TeamId`。服務端憑證可用部署秘密的 `Ecim:ApiKey` 提供；不會傳給瀏覽器。

## 使用方式

登入後，系統會依 UAC JWT 中的 `empNo` 對應本機帳號權限。

- **Guy**：從首頁建立指定會議日期的週報、維護跨課內容、接管卡住的租約，並發布正式版。發布後仍可編輯草稿；每次發布都會產生不可變的固定連結。
- **課長（Head）**：在自己的課別新增與編輯項目。按「開始編輯」取得 30 分鐘租約，內容先自動存為私有草稿；按「儲存完成」才會更新共用內容。
- **專案週報維護人**：取得專案編輯租約後建立階段，維護原始計畫、目前計畫、實際日期及明確狀態。建立後每次修改都須填原因；誤植須選「更正原始資料」，一般改期只更新目前計畫。可查看完整修訂前後值與完成偏差。甘特圖僅供檢視，點選項目後仍以表單修改。
- **eCIM 候選決策**：課長按「同步本課工程師工作」後，可針對來源候選建立項目、合併至既有項目、暫緩或忽略。已有人工修改的欄位會同時顯示上次來源、最新來源與目前週報值；可選擇維持人工版或套用來源。
- **正式版讀者（Reader）**：僅能進入正式版與固定版本連結；可在正式頁檢視時程甘特圖與偏差，並使用瀏覽器列印。

一般項目可附多個來源 URL 與待決策事項。若前週延續的待決策尚未處理，發布下週週報前必須填寫決策結果或新的期限。

UAC 登入需企業內網與可用的 `CertificateKey` 或 refresh token。

## 驗證

```powershell
dotnet build apps/api/WeeklyReport.Api.csproj
pnpm --dir apps/web build
node tests/smoke.mjs
node tests/browser-smoke.mjs
```

HTTP 煙霧測試以暫時 RSA 金鑰、JWKS 服務與 SQLite 資料庫驗證簽章、角色、日期唯一、四位編輯者同時修改不同項目、私有草稿、租約競爭與逾期、衝突、接管及修訂紀錄。瀏覽器測試以模擬 UAC 服務驗證 SSO 回跳、建立項目及提交；需先完成 Angular 建置並安裝 Playwright 和 Chrome。正式內網 UAC 仍需部署環境驗收。
