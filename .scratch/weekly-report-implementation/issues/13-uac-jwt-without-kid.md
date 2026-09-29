# 13: 驗證不含 kid 的 UAC JWT

**What to build:** Guy、課長與讀者可沿用不含 `kid` 的 UAC JWT 進入共同編輯器；後端從固定 UAC JWKS 取得唯一一把合格公鑰，驗證簽章、期限與 `empNo`，再套用既有角色與讀者權限。

**Blocked by:** None (can start immediately).

**Status:** done

- [x] 不含 `kid` 的有效 RS256 JWT 通過驗簽後，可依既有 `empNo` 權限存取週報 API；過期、缺少 `empNo` 或簽章不符者仍被拒絕。
- [x] 帶有 `kid` 的 JWT 明確拒絕，不以其值選擇金鑰，也不略過簽章驗證。
- [x] 固定 JWKS 中必須剛好有一把符合 RS256 的 RSA 公鑰；零把、多把或取得失敗時拒絕驗證並記錄可診斷的錯誤。
- [x] 公鑰在 API 執行期間快取；UAC 更換固定公鑰後，以重新啟動 API 重新載入。
- [x] 以 HTTP 行為測試覆蓋有效、無效及 JWKS 異常情境；同步修正實作規畫與架構決策中要求依 `kid` 選金鑰的敘述。
