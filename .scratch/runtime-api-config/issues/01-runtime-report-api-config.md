# 01: 以執行時設定連接週報 API

**What to build:** 週報前端從 `/assets/config.json` 讀取 API URL；開發時瀏覽器直接連接 API，正式部署可替換設定檔而不重建前端。使用者重新整理後會使用更新的設定。設定讀取失敗或內容無效時，應顯示可辨識的啟動錯誤並停止後續 API 與登入流程，避免連到錯誤環境。

**Blocked by:** None (can start immediately).

**Status:** done

- [x] 開發環境移除 Angular 開發 proxy 後，週報清單、編輯與授權請求仍可直接呼叫設定的 API；後端僅允許明確設定的前端來源通過 CORS。
- [x] 同一份前端建置可在不重建的情況下，以替換 `/assets/config.json` 切換 API URL；同源部署仍可使用相對 API 路徑。
- [x] 設定檔不存在、無法讀取、格式錯誤或 API URL 缺失／無效時，顯示明確錯誤且不發出週報 API 或 UAC 登入請求；不使用隱含的預設環境 URL。
- [x] 設定檔不含密鑰，且部署時對它使用 `Cache-Control: no-cache`；替換設定後，瀏覽器重新整理即可取得新值。
- [x] 驗證跨來源預檢、Bearer 授權標頭、同源與跨來源 URL，以及設定更新和失敗情境；更新開發與部署說明。
