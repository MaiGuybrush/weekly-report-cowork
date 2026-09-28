# 01: UAC 登入與建立首份週報

**What to build:** Guy 可沿用 UAC SSO 登入共同編輯器，建立指定處會日期的首份空白週報並看到六段章節。後端用 UAC JWT 的 `empNo` 對照週報系統角色；三位課長可登入查看草稿，但只有 Guy 可建立週報。

**Blocked by:** None (can start immediately).

**Status:** ready-for-agent

- [ ] 有效 RS256 JWT 經內網 JWKS 驗簽及期限檢查後，列名的 Guy 和課長可進入符合各自角色的首頁；無效、過期、缺少 `empNo` 或未列名者不能進入。
- [ ] Guy 能建立首份空白週報並看見處會日期與六段章節；相同日期重試建立只會取得同一份週報，不產生第二份。
- [ ] 課長與讀者呼叫建立週報操作時收到 403；未登入收到 401。Angular 路由保護與後端結果一致。
- [ ] 用實際 HTTP 請求與暫存 SQLite 驗證登入、角色及唯一處會日期；SSO 回跳能到原本要看的應用頁。
