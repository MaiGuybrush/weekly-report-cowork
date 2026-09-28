# 處會週報共同編輯

依 [實作規格](docs/implementation-spec.md) 建置的處會週報工作區。已具備 UAC JWT 身分驗證、按課別共編、私有草稿與租約、結構化專案時程、人事權限、不可變發布版、跨週延續、正式讀者入口，以及 eCIM 課別同步。

## 設定

需求：.NET SDK 9、Node.js 20.19 以上、pnpm、可連到 UAC 的內網環境。

API 從 `apps/api/appsettings.json` 讀取 `JwksUrl` 與 `DatabasePath`。`Access:Users` 需在首次啟動前設定 Guy、三位課長與正式版讀者的 `EmpNo`、`Name`、`Role` (`Guy`、`Head` 或 `Reader`)；課長另需 `Section`（例如 `s1`、`s2`、`s3`）。項目的 `section` 是六段報告章節，`ownerSection` 是可編輯該項目的課別，兩者彼此獨立。讀者無編輯頁權限。設定會於首次啟動匯入 SQLite；既有帳號不會因修改設定檔而覆寫，後續名單由 Guy 的受控 API 調整並留稽核。

人事項目以生效日期、交接、影響、下一步四欄保存；一般項目可附多個來源 URL 與待決策事項。下週草稿保留來源與上週承諾；未解待決事項在新週發布前須填決策結果或新期限。

`DatabasePath` 預設在 API 工作目錄的 `weekly-report.db`。正式部署時請設為持久磁碟上的絕對路徑。資料庫以 `CREATE TABLE IF NOT EXISTS` 建立初始結構；保存正式資料前需加入 migration 和備份流程。

eCIM 同步設定在 `Ecim`：`BaseUrl`、選用的 `ReviewWorkPath` 與每位工程師的 `Members` 設定。每筆成員設定需包含 `Section`、`UserId`、`UpdateDateFrom`、`UpdateDateTo`，並可附上 `TimeFrom`、`TimeTo`、`Division`、`Dept`、`TeamId`。服務端憑證可用部署秘密的 `Ecim:ApiKey` 提供；不會傳給瀏覽器。

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
