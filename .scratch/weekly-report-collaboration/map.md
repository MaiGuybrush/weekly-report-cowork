# 處會週報四人協作設計路線圖

Status: completed
Labels: wayfinder:map

## Destination

完成可供開發的處會週報共同編輯解決方案與週報架構設計，涵蓋架構、資料模型、畫面、權限、項目鎖定、專案管理流程及驗收條件。文件完成後另行開發 Prototype，驗證編輯器及最終報告呈現。

## Notes

- 訪談採一問一答，每次只向 Guy 提出一項待決策問題。
- 設計須參照 `weekly-report` 的 eCIM 工作取得方式、`weekly-meeting-report` 的上週延續與既有編輯器，以及根目錄 `CONTEXT.md`。
- 原有兩份協作設計草案因週三 17:00 發布、10 分鐘鎖等設定與已確認決策牴觸，已依 Guy 指示刪除；完成決策後重新撰寫設計文件。
- 本機 Markdown 為此專案的議題追蹤器；子票位於本目錄。
- 交付文件：[共同編輯解決方案設計](../../docs/solution-design.md)、[週報架構設計](../../docs/report-structure.md)；排版 Prototype 見「決定週報呈現與 Prototype 驗證範圍」票。

## Decisions so far

- [確定交付範圍與協作發布節奏](issues/01-scope-and-workflow.md)：交付可開發的設計文件；四人協作，週三各課補齊，週四上午由 Guy 整理並可重新發布。
- [確定編輯權限、鎖定與來源同步](issues/02-collaboration-and-import.md)：四人按責任編輯，項目級鎖與版本紀錄；課別批次同步 eCIM，欄位級保護人工覆寫。
- [確定週報章節與專案管理骨架](issues/03-report-and-project-shape.md)：六段式報告；專案以階段、里程碑和甘特圖追蹤，保留時程與風險等管理紀錄。
- [決定專案健康度與處會升級規則](issues/04-project-health.md)：維護人判定整體狀態；重要延期、高影響風險及需處級協調事項進管理摘要。
- [決定非專案章節的入選與管理規則](issues/06-non-project-content.md)：課長判斷需求與重大異常入選；人事限制可見；技術評估跨週追蹤；結案保留一週摘要。
- [決定週報呈現與 Prototype 驗證範圍](issues/05-publication-and-prototype.md)：正式版有固定連結；編輯器側欄可收合；Prototype 以真實資料檢驗排版與單人流程。

## Not yet specified

- 無；設計所需的決策已完成。

## Out of scope

- 既有資料與系統的遷移計畫：Guy 明確排除。
- 正式系統開發：在設計與 Prototype 檢視後另行執行。
- 三課成員與擷取時窗、前端 Template/JWT 契約、部署標準的具體值：屬實作整合輸入，設計文件已定義需要哪些資料。
