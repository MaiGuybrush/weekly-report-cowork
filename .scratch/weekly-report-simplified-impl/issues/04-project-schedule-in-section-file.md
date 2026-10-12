# 04 — 專案時程編輯與甘特圖

**What to build:** 課長在新編輯頁的課檔中維護專案：實際專案負責人、參與課別、階段、關鍵任務、重要里程碑、時程前置關係、取消與重新啟用，以及外部交付紀錄（以關聯的時程項目 id 連到時程項目，G6）。甘特圖即時反映編輯中的內容，含 ⚠ 警示與 🌐 外部交付通知。

儲存前跑時程規則；有驗證錯誤時不送出，並在畫面上指出錯誤項目。JSON 只存 `predecessors`，`successors`、警示與通知皆由前端推導，不寫入。

跨課專案放在統整課長的課檔中，由該課長編輯；專案卡顯示參與課別，其他參與課長在唯讀的課檔中可看到。日期只有計畫與實際兩組，改期直接覆寫計畫（歷史交給 git）；不提供時程變更紀錄。

依據：[簡化週報實作計畫](../../../docs/simplified-weekly-report-implementation-plan.md) 切片 4、5；[課別與跨課內容的擁有者](../../weekly-report-simplified/issues/01-owner-data-model.md)；[移除範圍確認](../../weekly-report-simplified/issues/02-scope-cut-list.md)。

**Blocked by:** [01 拆出甘特圖元件](01-extract-gantt-component.md)、[02 時程規則移到前端](02-schedule-rules-in-frontend.md)、[03 課長編輯並儲存課檔](03-section-head-edits-section-file.md)

**Status:** ready-for-agent

- [x] 課長可新增、修改專案的階段、關鍵任務、里程碑，以及計畫、實際日期
- [x] 可新增與移除前置關係；循環、跨專案、階段與直屬子任務的關係被拒，畫面顯示原因
- [x] 可取消與重新啟用時程項目；已取消項目可在甘特圖中顯示或隱藏
- [x] 可維護外部交付紀錄並關聯時程項目；逾期或未完成時甘特圖顯示 🌐
- [x] 儲存後寫入的 JSON 不含 `successors`、`warnings`、`externalNotices`、`history`、`version`、`continuityId`
- [x] 跨課專案顯示參與課別；非統整課長只能唯讀
- [x] 瀏覽器煙霧測試：課長建立一個含階段、任務、里程碑與前置關係的專案並儲存，重新載入後甘特圖正確顯示
