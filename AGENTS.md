# Agent 指引

- 一律使用中文（繁體）回覆使用者。程式碼、指令、錯誤訊息、commit 類型關鍵字維持原文。
- 驗證在 `apps/web`（根目錄沒有 package.json）：`npm run check`（tsc、單元測試、build）、`npm run smoke`（瀏覽器煙霧測試，含 API）。
- 領域詞彙看 [CONTEXT.md](CONTEXT.md)；各功能規格在 `docs/*-spec.md`，決定理由在 `docs/adr/`，票據在 `.scratch/<功能>/issues/`。
