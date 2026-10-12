# 03 — 清除舊設計文件與引用

**What to build:** repo 內不再有與現行規格矛盾的舊設計文件，文件導覽沒有失效連結，簡化週報規格與實作計畫描述兩組日期。

依據：[計畫／實際兩組日期規格](../../../docs/plan-actual-dates-spec.md)；[計畫／實際兩組日期](../../weekly-report-simplified/issues/08-plan-actual-two-dates.md)。

**Blocked by:** None — can start immediately.

**Status:** done

- [x] 刪除舊設計文件：共同編輯解決方案設計、週報架構設計、處會週報協作系統規格、舊實作計畫、專案時程重設計規格
- [x] 刪除前先全文搜尋引用（含 README、`CONTEXT.md`、`docs/adr/`、`docs/agents/`、`.scratch/`）；清除所有指向已刪文件的連結，全文搜尋不再找到
- [x] 簡化週報規格與實作計畫更新為兩組日期的描述；「取代舊文件」的待辦語句改為「已取代並刪除」
- [x] `CONTEXT.md` 的「原始計畫」「目前計畫」改為「計畫」「實際」，移除「更正原始計畫」相關詞條
- [x] 實作票據系列 `weekly-report-simplified-impl`：票 04 內「原始計畫、目前計畫」敘述改為兩組日期，並把已完成票的核取方塊補勾
