# 01 — 純拆元件，行為不變

**What to build:** 把過大的元件依邊界切開，畫面與行為完全不變：`Home` 移出根元件檔，週編輯拆出 `FileView`（單課區段表單）與 `CrossEditor`（管理摘要與待決策事項），專案標頭拆成編輯頁與正式版共用的 `ProjectHeader`。根元件只留 `App`。這是後續所有票的 prefactor。

**Blocked by:** None — can start immediately

**Status:** done

- [x] 既有單元測試、API HTTP 煙霧測試、`browser-smoke` 全綠
- [x] `report-app` 只留 `App`；`Home`、`FileView`、`CrossEditor`、`ProjectHeader` 各自獨立一檔
- [x] 畫面與現有 `data-*` 選擇器完全不變
