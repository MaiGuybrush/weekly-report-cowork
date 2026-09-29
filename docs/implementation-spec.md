# 處會週報協作系統規格

狀態：規格已同步，實作規畫待更新。2026-09-29。依[共同編輯解決方案設計](solution-design.md)、[專案時程重設計規格](project-schedule-redesign-spec.md)、[週報架構](report-structure.md)與[實作規畫](implementation-plan.md)整理；專案時程的詳細規則以前述重設計規格為準。本規格涵蓋第一階段共編、完整專案時程與發布，以及第二階段 eCIM 同步、來源連結與甘特圖；各階段按下述驗收條件獨立交付。

## Problem Statement

目前處會週報由個別工具與 JSON/HTML 檔案編製，缺少四位共同編輯者可同時使用的權威資料、項目級排他編輯、私有草稿、清楚的權限，以及可追溯的正式發布版本。各課工程師工作與處會內容之間需要人工篩選；專案日期多在敘述中，缺少階段、關鍵任務與單日里程碑的區別，也難以比較原始計畫、目前計畫、實際結果及相依影響。Guy 需要在週四處會前整合三課內容，並讓讀者始終能查到特定發布版。

## Solution

建立公司內網共同編輯器，讓 Guy 與三位課長按責任維護同一份工作草稿。系統沿用 UAC SSO 登入，以項目級租約及版本檢查保護共編；編輯中的內容先存為個人草稿，提交後才對其他人可見。Guy 每週手動建立週報、覆核並發布不可變版本。正式版有固定連結，適合投影與瀏覽器列印。

第一階段保存完整的章節及可稽核的專案時程：階段、關鍵任務與里程碑各有合適的日期和狀態，包含原始計畫、目前計畫、實際結果、相依關係、警示與完整修訂歷史。首次週報從空白建立；之後從前週最新已發布版延續未結案報告項目，持續中專案另延續完整時程圖。第二階段由後端呼叫 eCIM HTTP API，讓課長檢視來源差異並決定是否套用；維護人可手動連結 eCIM 工作，甘特圖使用第一階段保存的時程。

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
14. As a project report maintainer, I want phases and key tasks to have planned and actual periods while milestones have target and achievement dates, so that each kind represents its real schedule shape.
15. As a project report maintainer, I want every post-creation schedule change to require a reason and preserve before and after states, so that readers can understand the full history.
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
34. As a project report maintainer, I want a Gantt view of phase spans and milestone points against original, current and actual dates, with key tasks expandable, so that schedule variance is visible. (Phase 2)
35. As a project report maintainer, I want to confirm completion, reopen or cancel a schedule item explicitly, so that passing a date or finishing child tasks cannot silently change its state. (Phase 1)
36. As a project report maintainer, I want same-project predecessor links with cycle checks and nonblocking warnings, so that I can see which delivery affects another without automatic date changes. (Phase 1)
37. As a project report maintainer, I want to correct an original-plan entry error separately from replanning, so that variance remains meaningful and the first entry stays auditable. (Phase 1)
38. As a project report maintainer, I want the full schedule graph and history of an ongoing project carried into a later weekly draft, so that completed predecessors and open commitments remain connected. (Phase 1)
39. As a report reader, I want dates, statuses, links, warnings and revisions fixed in the publication I open, so that later edits cannot change what the meeting saw. (Phase 1)
40. As a project report maintainer, I want to link selected eCIM work to key tasks without source sync changing commitments, so that supporting evidence and the maintained plan remain distinct. (Phase 2)

## Implementation Decisions

- The client uses Angular 21 and the existing UAC SSO template. The backend uses ASP.NET Core 9 and serves both the API and the built client from one internal origin. API authorization is enforced by the backend.
- JWT authentication accepts UAC RS256 tokens, validates signature and `exp`, and requires `empNo`. The current token contract has no `sub`, `iss` or `aud`. Roles, section membership and reader access are mapped from `empNo` in SQLite; `empID` is the AD account and `empName` is display data.
- The JWT header must not contain `kid`. The signing key comes from the specified UAC JWKS endpoint over the approved internal HTTP network, which must contain exactly one RSA/RS256 key. Cache it for the API process lifetime and restart the API after UAC changes the key. Reject tokens if the JWKS has zero or multiple qualifying keys or cannot be loaded, and log the failure. Never accept an unsigned token or a different signing algorithm.
- A single ASP.NET Core instance owns the SQLite database on durable storage. Use foreign keys, transactions, unique constraints and optimistic item versions. Backups must be consistent and restorable.
- User access and report reader lists are seeded from deployment configuration, then changed through a controlled administrative operation that leaves an audit event. A reader must authenticate before opening any publication URL.
- One `Report` exists per meeting date. Guy creates it explicitly. The first report starts empty; later reports copy the previous latest publication's open report items and their stable continuity identifiers. An ongoing project carries its full schedule graph, including completed and cancelled schedule items, stable logical schedule identities, dependencies and revisions, into an independent new-week working version. Later changes to a prior week do not silently alter that version. Report items closed in the current report retain one closing summary in that report and leave the next report body.
- The report has management summary, projects, system operations (important requirements and major incidents), personnel changes, technology evaluations, and an engineer/source appendix. The appendix may contain manually linked sources in Phase 1; absence of eCIM integration is shown as unavailable source data, not zero work.
- `ReportItem` has a type-specific shape, owning section, maintainer, order, status, continuity identifier and monotonic version. A fact has one primary item; management summary and other locations refer to it instead of maintaining duplicate editable text.
- Phase 1 models phase, key task and milestone as distinct schedule kinds with stable logical identities. Phases and tasks have planned and actual start/end dates; tasks require a person or unit as owner, which may lack a local account, and may belong to a same-project phase or directly to the project. Ownership alone grants no schedule-edit permission. Milestones have separate original target, latest target and actual achievement dates, never a start/end range. Planned variance uses the effective original commitment, which changes only through an audited data-entry correction, not ordinary replanning.
- Phase and task states are open, in progress, completed and cancelled; milestones are pending, achieved and cancelled. Completion is explicit and requires actual dates; an overdue milestone stays pending. Reopening clears the current completion or achievement date while preserving history. A phase can be accepted with unfinished child tasks only with a visible warning and recorded reason. Cancellation resolves active successor links and phase children first; reactivation does not automatically restore removed links. An uncommitted private schedule draft can be discarded; a committed item cannot be hard-deleted.
- Phase 1 supports directed, advisory finish-to-start links between same-project schedule items, with multiple predecessors and successors. Reject self-links, cycles, cross-project links and links between a phase and its direct child task. Show plan-change notices, live incomplete-predecessor warnings, and date-order conflicts without blocking work or moving dates. External deliveries remain cross-department records linked to affected items, with separate unfinished or overdue notices.
- An item has at most one active 30-minute edit lease. The server validates permission, lease token, base version and content in one transaction when committing. Every schedule write uses the project item's lease and base project version, increments that version, and returns the current schedule on a stale-version conflict. Autosaved private drafts are visible only to their editor and are retained for conflict recovery. A management takeover records actor and reason.
- Every post-creation schedule edit, including status, dates, owner, phase membership and dependencies, requires a nonblank reason and appends actor, time, action and complete before/after values. Each commit creates an item revision and audit event. Publishing captures one consistent, immutable snapshot with a per-report version number; it includes the full schedule, evaluated warnings, revisions and linked source evidence as of publication. Authorized publication readers can inspect that history. Later edits affect the working draft, and republishing creates another immutable version and fixed URL.
- Personnel draft reads are filtered on the server to Guy and the relevant section head. Published personnel content is available only to authenticated authorized report readers and contains only meeting-relevant handover information.
- Phase 2 uses a backend eCIM HTTP client to call `GET /Work/ReviewWork` for configured members and windows. Its service credential stays on the server. Each member result records success or failure. Reimport is idempotent by source identity and period.
- Phase 2 tracks last source value, latest source value, report value and override state for synchronizable fields. Source changes produce candidates. Applying them requires a section head's decision and never mutates an already published snapshot. A project maintainer manually links selected eCIM work to key tasks using stable source identity and captured evidence; synchronization never creates, reschedules, completes or cancels a key task.
- Editor API operations include report creation/read, item read/write, lease acquire/renew/release, private draft save, commit, publication and version read. Return 401 for invalid authentication, 403 for insufficient rights, and 409 with conflict information for lease or version conflicts. Creation and publication requests must resist duplicate retries.

## Testing Decisions

- Test observable HTTP behavior against a temporary SQLite database as the primary seam. Authentication keys and eCIM responses can be supplied by local test fixtures; tests should assert responses and persisted effects rather than private method calls or table implementation details.
- Cover real token validation behavior: valid RS256 token without `kid`, expiry, missing `empNo`, wrong algorithm, a token with `kid`, zero or multiple qualifying JWKS keys, JWKS unavailability, and a reader absent from the allowlist.
- Cover authorization with Guy, each section head, a project maintainer, an unrelated section head and a report reader, including personnel draft and publication reads.
- Cover four editors on distinct items, two editors on one item, lease renewal and expiry, takeover audit, private draft isolation and a stale `baseVersion` commit.
- Cover first blank report, duplicate meeting-date creation, previous latest-publication continuation, closing summaries, publication retry, old immutable publication and post-publication changes. For ongoing projects, verify complete schedule identities, dependencies and history across weeks without retroactive changes to another week's working version.
- In Phase 1, cover kind-specific dates and status validation, original-plan correction versus replanning, full reasoned revisions, project lease/version conflicts, cycle and parent-child link rejection, live and historical warnings, external-dependency notices, cancellation and reactivation, and immutable publication snapshots. Check that completed or cancelled schedule items remain connected in later weekly drafts and that old publications retain their warnings and history.
- In Phase 2, cover per-member eCIM failures, duplicate import, candidate decisions, preserved manual overrides, source-unavailable presentation and manual key-task source links that do not change commitments. Test the Gantt display against the same dates as the Phase 1 project forms, with milestones as points and key tasks expandable; verify frozen source evidence in earlier publications.
- Add a small number of browser journeys for SSO return routing, item edit/commit/conflict, publication and print layout. The Angular template already has unit tests around certificate exchange, refresh, guard and interceptor; these are prior art for auth behavior. The existing eCIM API is documented and exercised through Swagger, but the weekly report integration needs its own contract fixtures.

## Out of Scope

- Historical JSON/HTML migration into the production database.
- A new login provider or a token issuer owned by this system.
- Server-generated PDF; the browser print dialog supplies PDF output.
- Direct drag editing of Gantt bars.
- Automatic schedule-date propagation, critical-path calculation, cross-project predecessor links and automatic promotion of eCIM work to key tasks.
- Automatic promotion of eCIM work to important requirements or major incidents.
- A requirements-ticket MCP integration, until its service contract exists.
- Multiple backend instances or a distributed database in the initial deployment.

## Further Notes

- Phase 1 is accepted after the shared editor, complete three-kind project schedule, dependency and audit rules, weekly continuation, immutable publication and reader page pass their stated behavior tests. Phase 2 is accepted after three sections can independently sync eCIM without overwriting human edits or schedule commitments, maintainers can link selected work to key tasks, and the Gantt view reflects the stored schedule.
- Deployment inputs include the four editors' `empNo` and section assignments, reader allowlist, internal URL, SQLite/backup directories, and Phase 2 member `userId` mapping, capture windows and eCIM service credentials.
- The internal HTTP JWKS decision assumes the network path and UAC host are trusted. A failed key load must be visible to operators and must not grant access without a verified signing key.
