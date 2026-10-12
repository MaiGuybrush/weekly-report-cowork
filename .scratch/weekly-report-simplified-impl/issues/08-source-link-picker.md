# 08 — 來源連結挑選

**What to build:** 課長在時程項目的 📎 面板中，從該週的工程師工作彙整挑選頂層工作項目（顯示 `workId`、工作內容、負責人、狀態），並為每筆寫摘要，存為來源連結（`workId` 加摘要）。子項目不單獨挑選，只在選中項目下方顯示，供撰寫摘要參考。該週沒有彙整檔時，面板仍可手動輸入 `workId` 與摘要。甘特圖 📎 計數為來源連結數。

工程師工作彙整放在伺服器設定目錄，不進資料 repo（G4）。後端取檔名結尾日期（`*_yyMMdd.json`）落在該週的檔案，多個時取最新，唯讀回傳；無檔回 404。

端點：`GET /api/weeks/{week}/engineer-work`（課長、部級）。

依據：[簡化週報實作計畫](../../../docs/simplified-weekly-report-implementation-plan.md) 切片 6；[週報 JSON 結構、草稿讀取與部署](../../weekly-report-simplified/issues/06-json-shape-and-deployment.md)；樣本 `docs/CIM3_ENG_WeeklyReport_261001.json`。

**Blocked by:** [04 專案時程編輯與甘特圖](04-project-schedule-in-section-file.md)

**Status:** ready-for-agent

- [x] 測試資料：縮小版的工程師工作彙整樣本
- [x] HTTP 煙霧測試：依週次取到正確檔案；同週多檔取最新；無檔回 404；檔名不符慣例的檔案被忽略
- [x] 課長挑選一筆並寫摘要，儲存後重新載入，📎 計數正確
- [x] 無彙整檔時可手動輸入並儲存
