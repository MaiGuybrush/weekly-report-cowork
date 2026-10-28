# 03 — 操作欄改為 icon 按鈕

**What to build:** 時程 grid 操作欄的按鈕全改為沒有文字的 icon 按鈕，說明文字改由 HTML `title` 屬性顯示（同時加 `aria-label` 供螢幕閱讀器）。icon 使用內嵌 SVG，不新增相依。

**Blocked by:** None — can start immediately

**Status:** done

- [x] 佐證（旁邊保留數量）、＋任務、取消、重新啟用、刪除皆為 icon 按鈕，無文字
- [x] 每個按鈕有 `title` 與 `aria-label`，文字與原按鈕相同
- [x] 專案層級的「新增階段／關鍵任務／里程碑」按鈕維持文字
- [x] 刪除維持立即刪除，不加確認
- [x] 既有功能不退化；操作欄寬度明顯縮小
- [x] 煙霧測試改用 `title`／`aria-label` 定位按鈕，既有操作測試全數通過
- [x] 更新 `docs/project-progress-grid-spec.md` 中操作欄的描述
