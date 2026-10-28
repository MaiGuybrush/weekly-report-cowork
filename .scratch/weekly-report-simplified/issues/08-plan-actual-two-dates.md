---
wayfinder: grilling (HITL)
status: closed
---

## Question

專案階段、關鍵任務、里程碑目前有原始／目前／實際三組日期。是否簡化為「計畫」與「實際」兩組？

## Resolution

- **欄位（Q1、Q2、Q4）：** 三種時程項目一律改為 `planStart/planEnd/planDate` + `actualStart/actualEnd/actualDate`；「計畫」即最新計畫，改期直接覆寫；舊的 `baseline*`、`forecast*` 移除。畫面標籤為「計畫」與「實際」。
- **舊資料（Q3）：** 不遷移，舊欄位忽略（尚未發布，repo 內無真實資料）。
- **偏差天數（Q5）：** 改為「實際 vs 計畫」；未完成或未達成顯示「—」。
- **甘特圖（Q6）：** 每列計畫條（淺）加實際條（深）；里程碑為計畫鑽石加實際鑽石；移除原始目標幽靈點。
- **相依檢查（Q7）：** 日期優先序由 `actual ?? forecast ?? baseline` 改為 `actual ?? plan`，行為不變。
- **原始資料更正（Q8）：** 取消「更正原始計畫」與「一般改期」的區分；歷史交給 git。
- **文件（Q9、Q10）：** 刪除舊設計文件 `solution-design.md`、`report-structure.md`、`implementation-spec.md`、`implementation-plan.md`、`project-schedule-redesign-spec.md`，並清除 `.scratch/` 內對它們的所有引用；更新 `simplified-weekly-report-*.md` 與 `simplified-impl/issues/*`；測試（`tests/*`）同步修改。

## Blocked by

（無）
