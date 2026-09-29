# 02: 以執行時設定連接 UAC SSO

**What to build:** 週報使用同一份執行時設定中的 UAC URL 完成登入初始化、憑證交換、更新登入資訊與 SSO 導向；部署時替換設定即可切換 UAC 端點，且既有登入後回到原頁的體驗不變。

**Blocked by:** 01: 以執行時設定連接週報 API。

**Status:** done

- [x] UAC URL 不再寫死於前端程式；部署時只替換設定檔即可切換 UAC 端點，無須重建前端。
- [x] 使用設定的 UAC URL 執行 refresh token 更新、`CertificateKey` 驗證與取得 SSO 登入頁；Bearer token 僅送往週報 API，不誤送至 UAC。
- [x] 設定缺少或無效的 UAC URL 時，啟動即顯示明確錯誤；HTTPS 頁面不得嘗試呼叫不安全的 HTTP UAC 端點。
- [x] 驗證查詢參數與 hash 中的憑證交換、失敗後重新登入，以及登入後返回原頁；記錄跨來源 UAC 必要的 CORS 與 HTTPS 部署條件。
