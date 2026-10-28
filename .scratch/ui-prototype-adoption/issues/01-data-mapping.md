---
wayfinder: grilling (HITL)
status: closed
---

## Question

原型假資料（`projects[].schedule`、`items[].section/details`、`decisions`、`summary`）與現有 `report-types.ts`、`ScheduleEntry`、簡化規格的 JSON 結構逐項對照：哪些已對應、哪些原型多出（待決策事項、交接／影響／下一步、管理摘要、`participants`）、哪些現有有而原型沒有？多出的功能納入、延後或捨棄？

## Blocked by

（無）

## Resolution

- **JSON 不動，UI 轉接**：原型多出的功能（待決策事項、交接／影響／下一步、管理摘要、participants）`report-types.ts` 都已有；只差命名（summary↔`managementSummary`、decisions↔`pendingDecisions`）與結構（原型 projects/items 分開；現有 projects 是 `section: "projects"` 的 item）。以元件內 view model 轉換，不改 JSON。
- **保留顯示**：`externalDependencies`、`evidenceLinks`（📎）、`sourceLinks`。原型沒畫，須在畫面對應／元件票據決定放哪裡（見 06）。
- **捨棄顯示（資料照留）**：`previousCommitment`、單項 `details.pendingDecision`。
- **待決策只留跨課清單**：由統整課長在跨課維護；單項 pendingDecision 不再顯示或編輯。
- 缺口：無需新欄位。
