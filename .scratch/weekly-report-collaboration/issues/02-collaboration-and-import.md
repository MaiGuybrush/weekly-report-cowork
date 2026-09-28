# 確定編輯權限、鎖定與來源同步

Status: completed
Labels: wayfinder:grilling
Parent: [處會週報四人協作設計路線圖](../map.md)
Assignee: Codex
Blocked by: None

## Question

四位編輯者如何避免互相覆寫、取得身分，以及將 eCIM 工作同步進草稿？

## Comments

- 2026-09-26 Resolution: 既有前端 Template 負責 SSO 登入並取得 JWT，後端依 JWT 取得人員資料並檢查權限。開啟項目編輯時取得 30 分鐘可續期的項目級排他鎖，其他人可閱讀；儲存、離開或逾時釋放。保留版本紀錄。課長手動執行所屬課別的批次 eCIM 同步，先檢視差異再套用。每個可同步欄位保留上次來源值、最新來源值、目前報告值與人工覆寫狀態；人工編輯過的欄位保留並提示來源更新，不用文字比對推測。
