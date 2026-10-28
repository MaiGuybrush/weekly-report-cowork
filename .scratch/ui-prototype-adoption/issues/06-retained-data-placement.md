---
wayfinder: prototype (HITL)
status: closed
assignee: guy.mai
---

## Question

原型未畫、但決定保留的資料——`externalDependencies`、`evidenceLinks`（📎）、`sourceLinks`——在新視覺下放在哪裡、怎麼編輯與在正式版呈現？（原型專案區塊與甘特圖都沒有這些位置。）

## Blocked by

- 02-screens-and-routes

## Resolution

以文字版面配置（非程式原型）與使用者確認；現況事實：`sourceLinks` 目前沒有任何編輯 UI（僅 `report-types.ts` 型別與孤兒樣式 `.source-link-row`）。

- **externalDependencies（外部交付）**：專案區塊在「時程明細」details 之下新增第二個 details「外部交付（N 項）」，表格列編輯（內容／供應者／到期日／狀態／關聯時程項目、刪除、新增）。正式版：甘特下方唯讀簡表（內容／供應者／到期日／狀態）。唯讀規則沿用 `canEdit`。
- **evidenceLinks（📎）**：沿用現行互動——僅關鍵任務、可編輯時，明細列尾 `📎 N` 按鈕展開面板（已連結＋摘要、候選工單挑選、手動 workId）。甘特保留 📎 chip；正式版任務列尾顯示 `📎 N`，title 帶摘要。不做抽屜。
- **sourceLinks**：本輪補編輯入口——每個非專案分項 item 卡片底部「來源連結」列表（標籤＋網址＋移除、＋新增）；正式版項目下方顯示為可點連結。屬新增 UI，資料結構不變。
- 缺口：無需新欄位。`data-*` 測試契約沿用現有 `data-evidence-toggle`／`data-add-dependency` 等（見 04）。
