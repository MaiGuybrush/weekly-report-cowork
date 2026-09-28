# 處會週報共同編輯

依 [實作規格](docs/implementation-spec.md) 建置的第一階段工作區。目前完成票據 01–03：UAC JWT 身分驗證、首份空白週報、六章節導覽、按課別的項目編輯、30 分鐘排他租約、私有草稿、衝突比較、接管與修訂紀錄。正式發布、上週延續、專案結構化欄位及 eCIM 同步屬後續票據。

## 設定

需求：.NET SDK 9、Node.js 20.19 以上、pnpm、可連到 UAC 的內網環境。

API 從 `apps/api/appsettings.json` 讀取 `JwksUrl` 與 `DatabasePath`。`Access:Users` 需在首次啟動前設定 Guy 與三位課長的 `EmpNo`、`Name`、`Role` (`Guy` 或 `Head`) 和課長的 `Section`（例如 `s1`、`s2`、`s3`）。項目的 `section` 是六段報告章節，`ownerSection` 是可編輯該項目的課別，兩者彼此獨立。讀者角色目前無編輯頁權限。設定會於首次啟動匯入 SQLite；既有帳號不會因修改設定檔而覆寫。

`DatabasePath` 預設在 API 工作目錄的 `weekly-report.db`。正式部署時請設為持久磁碟上的絕對路徑。資料庫以 `CREATE TABLE IF NOT EXISTS` 建立初始結構；保存正式資料前需加入 migration 和備份流程。

## 啟動

```powershell
dotnet restore apps/api/WeeklyReport.Api.csproj --configfile NuGet.Config
dotnet run --project apps/api/WeeklyReport.Api.csproj --no-launch-profile --urls http://localhost:5080
```

另開終端機：

```powershell
cd apps/web
pnpm install
pnpm start
```

瀏覽 `http://localhost:4200`。Angular 開發伺服器將 `/api` 轉送到本機 API。部署同源版本時，先執行 `pnpm --dir apps/web build`，API 會從 `apps/web/dist/weekly-report-web/browser` 提供靜態檔。UAC 登入需企業內網與可用的 `CertificateKey` 或 refresh token。

## 驗證

```powershell
dotnet build apps/api/WeeklyReport.Api.csproj
pnpm --dir apps/web build
node tests/smoke.mjs
node tests/browser-smoke.mjs
```

HTTP 煙霧測試以暫時 RSA 金鑰、JWKS 服務與 SQLite 資料庫驗證簽章、角色、日期唯一、四位編輯者同時修改不同項目、私有草稿、租約競爭與逾期、衝突、接管及修訂紀錄。瀏覽器測試以模擬 UAC 服務驗證 SSO 回跳、建立項目及提交；需先完成 Angular 建置並安裝 Playwright 和 Chrome。正式內網 UAC 仍需部署環境驗收。
