# 01 — 起訖日期精簡顯示

**What to build:** 時程 grid 的計畫起訖與實際起訖平時只顯示 `mm-dd~mm-dd`，欄位大幅縮小；點一下才彈出原本的日期範圍選擇器編輯。日期格式為純函式，先寫測試（tdd）。

**Blocked by:** None — can start immediately

**Status:** done

- [x] 同年顯示 `mm-dd~mm-dd`；起訖跨年或不是今年時，改顯示 `yy-mm-dd~yy-mm-dd`
- [x] 里程碑單日顯示 `mm-dd`；只填一端顯示 `mm-dd~` 或 `~mm-dd`；都沒填顯示 `—`
- [x] tooltip（`title`）一律顯示完整日期
- [x] 點擊文字開啟日期範圍選擇器，編輯能力與現況相同；已取消或唯讀時不可編輯
- [x] 日期格式純函式單元測試，涵蓋同年、跨年、非今年、單端、空值、單日
- [x] 煙霧測試：文字格式正確、點擊後可改日期
- [x] 更新 `docs/project-progress-grid-spec.md` 中日期欄的描述
