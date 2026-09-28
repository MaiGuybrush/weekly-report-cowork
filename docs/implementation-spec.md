# 處會週報協作系統規格

狀態：ready-for-agent。2026-09-28。依[共同編輯解決方案設計](solution-design.md)、[週報架構](report-structure.md)與[實作規畫](implementation-plan.md)整理。本規格涵蓋第一階段共編與發布，以及第二階段 eCIM 同步與甘特圖；各階段按下述驗收條件獨立交付。

## Problem Statement

目前處會週報由個別工具與 JSON/HTML 檔案編製，缺少四位共同編輯者可同時使用的權威資料、項目級排他編輯、私有草稿、清楚的權限，以及可追溯的正式發布版本。各課工程師工作與處會內容之間需要人工篩選；專案日期多在敘述中，難以對照基準與預估時程。Guy 需要在週四處會前整合三課內容，並讓讀者始終能查到特定發布版。

## Solution

建立公司內網共同編輯器，讓 Guy 與三位課長按責任維護同一份工作草稿。系統沿用 UAC SSO 登入，以項目級租約及版本檢查保護共編；編輯中的內容先存為個人草稿，提交後才對其他人可見。Guy 每週手動建立週報、覆核並發布不可變版本。正式版有固定連結，適合投影與瀏覽器列印。

第一階段保存完整的章節與結構化專案時程；首次週報從空白建立，之後從前週最新已發布版延續。第二階段由後端呼叫 eCIM HTTP API，讓課長檢視來源差異並決定是否套用；專案甘特圖直接使用第一階段保存的日期。

## User Stories

1. As Guy, I want to establish the first weekly report from a blank draft, so that the system can start without migrating old files.
2. As Guy, I want to create exactly one draft for a meeting date, so that repeated clicks cannot produce competing reports.
3. As Guy, I want each later draft to continue from the previous latest publication, so that open work and commitments remain visible.
4. As a section head, I want to sign in with the existing UAC SSO flow, so that I do not need another account.
5. As a report reader, I want access only when my employee number is on the reader list, so that a copied URL does not grant access.
6. As a section head, I want to see and edit my own section's items, so that I can prepare my section's contribution.
7. As Guy, I want to edit the management summary and cross-section content, so that I can present a coherent department report.
8. As a project report maintainer, I want to update the project's overall record, so that cross-section progress has one responsible editor.
9. As a participating section head, I want to update my assigned project work and propose schedule changes, so that the maintainer can consider them.
10. As Guy or the relevant section head, I want personnel drafts visible only to us, so that unrelated section heads cannot read them.
11. As an editor, I want the six report sections in a navigable editor, so that I can locate and revise an item quickly.
12. As an editor, I want to collapse navigation and comparison panels, so that the editing area has enough width.
13. As a section head, I want to choose which requirements and incidents belong in the report body, so that source activity does not automatically become management content.
14. As a project report maintainer, I want to record phases and important milestones with baseline, forecast and actual dates, so that schedule changes are measurable.
15. As a project report maintainer, I want to record a reason when a baseline changes, so that readers can understand the change history.
16. As a project report maintainer, I want to record risks, active problems, cross-department dependencies and pending decisions separately, so that their state and owner are clear.
17. As an editor, I want to acquire a 30-minute lease before changing an item, so that another editor cannot commit to the same item concurrently.
18. As an editor, I want to renew my lease while working, so that an active session is not interrupted by the initial deadline.
19. As another editor, I want to read the last committed version of a locked item and see who holds its lease, so that I know when I can edit it.
20. As an editor, I want automatic private draft saving, so that an interruption does not erase unfinished work.
21. As an editor, I want to commit an item explicitly, so that unfinished text is never shown as shared content.
22. As an editor, I want a conflict view when a lease or version is stale, so that I can compare and reapply my private draft without silent overwrite.
23. As Guy, I want to take over a stuck lease with a recorded reason, so that work can proceed with an audit trail.
24. As Guy, I want to publish a consistent snapshot with a version number, so that meeting readers see a stable report.
25. As Guy, I want to continue editing after publication and publish a later version, so that meeting follow-ups can be incorporated.
26. As a report reader, I want a fixed link to a specific publication, so that the content I cite does not change.
27. As a report reader, I want projection and print layouts, so that the same publication works in the meeting and on paper.
28. As an editor, I want last week's unresolved decisions and commitments carried forward, so that they cannot disappear silently.
29. As a section head, I want a closed item summarized once in its closing week, so that the next report can omit it while history stays available.
30. As a section head, I want to trigger a batch sync for my section's engineers, so that I can review this week's eCIM work in one place. (Phase 2)
31. As a section head, I want to see each engineer's sync result and last successful time, so that a source failure is not mistaken for no activity. (Phase 2)
32. As a section head, I want to accept, merge, defer or ignore source candidates, so that I control what enters the report. (Phase 2)
33. As an editor, I want a manually overridden field preserved when eCIM changes, so that a sync cannot erase my judgment. (Phase 2)
34. As a project report maintainer, I want a Gantt view of phases and milestones against baseline and forecast, so that schedule variance is visible. (Phase 2)

## Implementation Decisions

- The client uses Angular 21 and the existing UAC SSO template. The backend uses ASP.NET Core 9 and serves both the API and the built client from one internal origin. API authorization is enforced by the backend.
- JWT authentication accepts UAC RS256 tokens, validates signature and `exp`, and requires `empNo`. The current token contract has no `sub`, `iss` or `aud`. Roles, section membership and reader access are mapped from `empNo` in SQLite; `empID` is the AD account and `empName` is display data.
- Public signing keys come from the specified UAC JWKS endpoint over the approved internal HTTP network. Cache keys by `kid`; on an unknown `kid`, refresh and reject the token if a valid matching key cannot be obtained. Never accept an unsigned token or a different signing algorithm.
- A single ASP.NET Core instance owns the SQLite database on durable storage. Use foreign keys, transactions, unique constraints and optimistic item versions. Backups must be consistent and restorable.
- User access and report reader lists are seeded from deployment configuration, then changed through a controlled administrative operation that leaves an audit event. A reader must authenticate before opening any publication URL.
- One `Report` exists per meeting date. Guy creates it explicitly. The first report starts empty; later reports copy the previous latest publication's open items and their stable continuity identifiers. Items closed in the current report retain one closing summary in that report and leave the next report body.
- The report has management summary, projects, system operations (important requirements and major incidents), personnel changes, technology evaluations, and an engineer/source appendix. The appendix may contain manually linked sources in Phase 1; absence of eCIM integration is shown as unavailable source data, not zero work.
- `ReportItem` has a type-specific shape, owning section, maintainer, order, status, continuity identifier and monotonic version. A fact has one primary item; management summary and other locations refer to it instead of maintaining duplicate editable text.
- Project phases and milestones are structured in Phase 1, including baseline, current forecast and actual dates. Baseline edits require a reason and preserve before and after values. Phase 1 renders forms and lists; Phase 2 adds the Gantt view over the same records.
- An item has at most one active 30-minute edit lease. The server validates permission, lease token, base version and content in one transaction when committing. Autosaved private drafts are visible only to their editor and are retained for conflict recovery. A management takeover records actor and reason.
- Each commit creates a new item revision and audit event. Publishing captures one consistent, immutable snapshot with a per-report version number. Later edits affect the working draft, and republishing creates another immutable version and fixed URL.
- Personnel draft reads are filtered on the server to Guy and the relevant section head. Published personnel content is available only to authenticated authorized report readers and contains only meeting-relevant handover information.
- Phase 2 uses a backend eCIM HTTP client to call `GET /Work/ReviewWork` for configured members and windows. Its service credential stays on the server. Each member result records success or failure. Reimport is idempotent by source identity and period.
- Phase 2 tracks last source value, latest source value, report value and override state for synchronizable fields. Source changes produce candidates. Applying them requires a section head's decision and never mutates an already published snapshot.
- Editor API operations include report creation/read, item read/write, lease acquire/renew/release, private draft save, commit, publication and version read. Return 401 for invalid authentication, 403 for insufficient rights, and 409 with conflict information for lease or version conflicts. Creation and publication requests must resist duplicate retries.

## Testing Decisions

- Test observable HTTP behavior against a temporary SQLite database as the primary seam. Authentication keys and eCIM responses can be supplied by local test fixtures; tests should assert responses and persisted effects rather than private method calls or table implementation details.
- Cover real token validation behavior: valid RS256 token, expiry, missing `empNo`, wrong algorithm, unknown `kid`, and a reader absent from the allowlist.
- Cover authorization with Guy, each section head, a project maintainer, an unrelated section head and a report reader, including personnel draft and publication reads.
- Cover four editors on distinct items, two editors on one item, lease renewal and expiry, takeover audit, private draft isolation and a stale `baseVersion` commit.
- Cover first blank report, duplicate meeting-date creation, previous latest-publication continuation, closing summaries, publication retry, old immutable publication and post-publication changes.
- Cover project baseline history and reason validation, plus browser projection/print visibility for a publication with realistic content lengths.
- In Phase 2, cover per-member eCIM failures, duplicate import, candidate decisions, preserved manual overrides and source-unavailable presentation. Test the Gantt display against the same dates as the Phase 1 project forms.
- Add a small number of browser journeys for SSO return routing, item edit/commit/conflict, publication and print layout. The Angular template already has unit tests around certificate exchange, refresh, guard and interceptor; these are prior art for auth behavior. The existing eCIM API is documented and exercised through Swagger, but the weekly report integration needs its own contract fixtures.

## Out of Scope

- Historical JSON/HTML migration into the production database.
- A new login provider or a token issuer owned by this system.
- Server-generated PDF; the browser print dialog supplies PDF output.
- Direct drag editing of Gantt bars.
- Automatic promotion of eCIM work to important requirements or major incidents.
- A requirements-ticket MCP integration, until its service contract exists.
- Multiple backend instances or a distributed database in the initial deployment.

## Further Notes

- Phase 1 is accepted after the shared editor, structured project dates, weekly continuation, immutable publication and reader page pass their stated behavior tests. Phase 2 is accepted after three sections can independently sync eCIM without overwriting human edits, and the Gantt view reflects the stored schedule.
- Deployment inputs include the four editors' `empNo` and section assignments, reader allowlist, internal URL, SQLite/backup directories, and Phase 2 member `userId` mapping, capture windows and eCIM service credentials.
- The internal HTTP JWKS decision assumes the network path and UAC host are trusted. A failed refresh must be visible to operators and must not grant access to an unknown signing key.
