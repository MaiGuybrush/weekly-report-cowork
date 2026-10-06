---
wayfinder: grilling (HITL)
status: closed
assignee: guybr
---

## Question

後端是否改寫為 Python？

判斷依據不是語言本身，而是移除功能後剩下的程式量與維護成本。需要的事實：

- 移除功能後，後端實際要做什麼（若 JSON 為唯一來源，後端可能只剩靜態檔與 JWT 驗證）。
- 現有 C# 後端中可保留的部分：`JwtVerifier.cs`、`EcimClient.cs`。
- 兩種語言在相同功能下的程式量估算。

若移除後後端變得極小，改寫成本低，可考慮 Python；否則維持 C#。

## Resolution

- **後端保留（Q1）**：後端保留。服務帳號 commit 與發布打 tag 需伺服器持有憑證，純靜態前端無法安全承擔。後端職責縮為：靜態檔託管、JWT 驗證、草稿寫入（git commit）、發布（複製快照、打 tag、更新 `publications/index.json`）。
- **語言維持 C#（Q2）**：不改寫 Python。移除功能後後端約 300–500 行，改寫的收益不足以抵銷新棧的成本，尤其 JWT 驗證屬安全路徑，沿用 `JwtVerifier.cs`。
- **登入沿用 SSO/JWT（Q3）**：保留 `JwtVerifier.cs`（RS256 對 UAC JWKS 驗證，取得 empNo）。角色只剩「課長」與「部級」。

**盤點依據**（`apps/api`，子代理結果）：後端 2714 行。移除 eCIM（282 行）與鎖定/共編/修訂/時程歷史（234 行）；`Program.cs` 其餘 CRUD 與 `Store.cs`（SQLite）隨 JSON 為唯一來源而不再需要。

**更正**：原問題提及的 `EcimClient.cs` 屬 eCIM，隨 [移除範圍確認](02-scope-cut-list.md) 一併移除，不在保留清單內。

## Blocked by

- [02 移除範圍確認](02-scope-cut-list.md)
- [03 甘特圖輸入契約](03-gantt-input-contract.md)
