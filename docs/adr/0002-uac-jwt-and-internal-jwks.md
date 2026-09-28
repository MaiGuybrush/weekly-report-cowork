---
status: accepted
date: 2026-09-28
---

# 沿用 UAC JWT 並由內網 HTTP JWKS 取得公鑰

前端沿用既有 UAC SSO。現有 JWT 提供 `empNo`、`empID`、`empName` 與 `exp`，未提供 `sub`、`iss` 或 `aud`；因此後端驗證 RS256 簽章與期限，以 `empNo` 對照本系統 SQLite 中的角色、課別及讀者權限。另建登入或要求不存在的 issuer/audience 欄位會破壞現有整合。

公鑰從指定 UAC JWKS URL 依 `kid` 擷取及快取。公司內網目前可用 HTTP，HTTPS 443 不可用；使用者決定初期先用 HTTP。這使服務信任內網至 UAC 的傳輸路徑。未知 `kid` 刷新失敗時拒絕 token，並記錄認證服務錯誤；未來 UAC 提供 HTTPS 時可變更金鑰取得方式。
