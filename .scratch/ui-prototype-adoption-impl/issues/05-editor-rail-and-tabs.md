# 05 — 週編輯 rail、頁籤與路由

**What to build:** 編輯路由改為 `weeks/:week/:file/:tab`，預設導向自己的課（部級導向跨課）。單頁堆疊改為 rail（三課＋跨課）加頁籤；rail 標示唯讀，頁籤帶項目數；唯讀規則沿用 `canEdit` 並顯示 🔒 說明。切週保留課別與頁籤。rail／頁籤使用 tablist／tab 語意與 `aria-current`／`aria-selected`。

**Blocked by:** 04 Shell 與首頁

**Status:** ready-for-agent

- [ ] 補 `data-rail-file`、`data-tab`
- [ ] 深連結直接開啟對應課別與頁籤
- [ ] 課長預設進自己的課、部級預設進跨課
- [ ] 課長視角他課與跨課 rail 標唯讀且不可編輯
- [ ] 不存在的課別或頁籤導回首頁並提示
