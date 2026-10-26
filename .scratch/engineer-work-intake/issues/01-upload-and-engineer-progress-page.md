# 01 — 上傳與檢視工程師進度頁

**What to build:** 課長上傳所屬課別的工程師工作彙整 JSON，驗證後存進資料 repo 該週資料夾並 commit；新增「工程師進度」頁（課別編輯導覽，與頁籤並列），顯示依工程師分組的多層工作樹、工時總覽、耗時 ≥10H 標示、RMS 標記。週次由檔名日期（`*_yyMMdd.json`）推得。拒絕條件：`target_section` 與登入課別不符、非 JSON 或缺必要欄位、檔名不符、週次早於該課已有資料。同週重傳以 `workId` 合併，新檔缺的工作保留最後快照。課長只能上傳與檢視自己課，部級唯讀三課，課長互不可見。規格見 [docs/engineer-work-intake-spec.md](../../../docs/engineer-work-intake-spec.md)。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] HTTP 煙霧測試：課別不符、檔名不符、非 JSON、週次較舊皆被拒絕並回原因；成功上傳寫入資料 repo 並 commit；同週重傳依 `workId` 合併；部級可讀三課；課長無法讀他課
- [ ] 測試資料：以 `temp/eng-works-data` SEC1 結構縮小的多層樣本（至少三層、含 RMS 與耗時 ≥10H、含 `'?'` 的 `deltaPert`）
- [ ] 課長上傳後在工程師進度頁看到多層樹、工時總覽、耗時標示與 RMS 標記
- [ ] 新檔缺漏的工作保留，並顯示「本週彙整未出現此工作（可能本週無進度）」
