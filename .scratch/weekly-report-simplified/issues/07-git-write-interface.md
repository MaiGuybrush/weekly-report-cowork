---
wayfinder: grilling (HITL)
status: closed
assignee: guybr
---

## Question

後端以哪種方式執行草稿 commit 與發布 tag：git CLI，或 GitHub REST API？

## Resolution

- **採用 git CLI**：後端在資料 repo 的本機工作目錄執行 `git add/commit/tag/push`。服務帳號憑證由伺服器環境提供。
- 理由：與「後端讀工作目錄」（06）一致；發布快照與 tag 在同一份本機複本上操作。

## Blocked by

（無）
