# 01: 對齊 UAC SSO 啟動與回跳流程

**What to build:** 使用者開啟週報時，系統依 ums-app 的初始化流程更新 UAC 登入狀態；需要登入時自動前往 SSO，登入完成後回到原本要看的週報頁面。登入資訊保留於瀏覽器的 `localStorage`。

**Blocked by:** None (can start immediately).

**Status:** done

- [x] 每次啟動時嘗試以 refresh token 更新登入資訊；沒有可用登入狀態或更新失敗時，清除舊登入資訊並導向 SSO。
- [x] 同時接受網址查詢參數與 hash 中的 `CertificateKey`；在驗證請求前從網址移除憑證，避免重新整理時重複驗證。
- [x] 憑證驗證成功時保存 token 與 refresh token 至 `localStorage`；驗證失敗時清除舊登入資訊，並以不含失效憑證的回跳網址導向 SSO。
- [x] 以 `reportReturnPath` 保存並恢復使用者原本要看的 hash 路由，包括直接開啟週報頁面後登入的情境。
- [x] 驗證啟動 refresh、查詢參數與 hash 憑證交換、失敗回跳，以及原路由恢復；既有 API 授權標頭和角色路由保護仍正常運作。
