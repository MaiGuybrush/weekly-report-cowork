# 01 — 拆分進度頁元件（預先重構）

**What to build:** 把現有工程師進度頁的單一大元件拆成名冊、工時總覽、工程師區塊、工作列、評語編輯等較小元件，為後續四張票鋪路。對外屬性（週、檔案、可編輯、上傳事件）與畫面、行為完全不變；編輯器整合處不需改動。

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] 元件依職責拆開，對外屬性與上傳事件不變
- [ ] 畫面與互動與拆分前一致（上傳、★、comment、僅顯示重要、多層樹、耗時與 RMS 標記）
- [ ] 不修改任何既有測試，`npm run check` 與 `npm run smoke` 於 `apps/web` 維持通過
- [ ] 詞彙遵循 [CONTEXT.md](../../../CONTEXT.md)（子工作、重要工作）
