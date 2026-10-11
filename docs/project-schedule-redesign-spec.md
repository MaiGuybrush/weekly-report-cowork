# 專案時程重設計規格

> **已由[簡化週報解決方案規格](simplified-weekly-report-spec.md)取代。** 本文件僅供歷史參考。

狀態：設計決策已確認，待同步既有文件。2026-09-29。本規格根據專案時程規劃討論制定，取代既有文件中關於「專案階段／重要里程碑共用起訖日期」的設計，以及只記錄基準變更的規則；保留處會週報的共編權限與不可變發布原則，並細化專案時程的跨週延續。專案尚未發布，無須轉換現有專案時程資料。

## Problem Statement

週報維護人目前以相同的起訖日期欄位編輯專案階段與重要里程碑。重要里程碑本應是交付或決策的單日節點，畫面與資料卻允許它跨越一段期間。現有時程也缺少關鍵任務與真正可操作的項目間相依關係，難以指出哪件工作阻礙哪個節點。只有計畫基準異動留有原因和履歷，其他日期、狀態、負責人與相依關係變更無法完整追溯。處會讀者需要看出最初承諾、目前目標、實際進度及延期影響，而維護人需要控制哪些工程師工作提升為專案交付承諾。

## Solution

專案時程分成三種項目：**專案階段**是一段有交付成果的工作期間；**關鍵任務**是影響交付的具體工作，可歸屬一個階段或直接隸屬專案；**重要里程碑**是單日的交付或決策節點。階段與關鍵任務維護預計起訖、實際起訖及明確狀態。里程碑分別保存原始目標日、最新目標日及實際達成日；甘特圖未達成時以最新目標日為主要圖標，達成後以實際達成日為主要圖標，詳情仍可查看最新目標日。各項目保留建立時的原始計畫及完整修改履歷，時程偏差與最初計畫比較。

同一專案內，三種項目可建立「前置項目完成後才能推進」的相依關係。系統拒絕自我相依與循環，對前置未完成、延期或順序衝突提供警示；警示不阻止實際工作，也不自動改動後續日期。專案外的交付仍記為跨部門相依事項，可關聯受影響的本專案項目。週報維護人手動挑選 eCIM 工作作為關鍵任務的來源連結；eCIM 同步不直接建立關鍵任務或改動承諾。

處會摘要與甘特圖預設呈現階段與重要里程碑，關鍵任務可在專案詳情展開。所有修改都由有權維護專案時程的人執行，並記錄原因及前後值。發布版保存當時完整、不可變的時程與相依關係快照。

## User Stories

1. As a project report maintainer, I want to create a phase with a planned start and end, so that a period of work has a visible schedule.
2. As a project report maintainer, I want to record a phase's actual start and completion dates, so that the work period can be compared with its plan.
3. As a project report maintainer, I want to confirm phase completion myself, so that completed tasks alone do not imply accepted deliverables.
4. As a project report maintainer, I want to see when every key task in a phase is complete, so that I can review whether its deliverable is ready to accept.
5. As a project report maintainer, I want to create a key task with a required owner and planned start and end, so that a critical delivery has an accountable person or unit and an explicit time window.
6. As a project report maintainer, I want to place a key task in one phase or directly under the project, so that cross-phase work is represented without a false parent.
7. As a project report maintainer, I want to record a key task's actual start and completion dates and mark it complete explicitly, so that its status reflects confirmed progress.
8. As a project report maintainer, I want to name an owner from another department even if that person has no account, so that external responsibility is visible.
9. As a project report maintainer, I want to create a milestone with one required target date, so that a delivery or decision is shown as a point in time.
10. As a project report maintainer, I want to mark a milestone achieved with its actual date, so that its one displayed date becomes the date of achievement.
11. As a project report maintainer, I want an overdue milestone to remain unachieved until I confirm it, so that passing its target date cannot falsely report completion.
12. As a project report maintainer, I want to correct a mistaken completion date or reopen an item with a reason, so that errors can be fixed without erasing their audit trail.
13. As a project report maintainer, I want every date change to require a reason and retain its before and after values, so that schedule adjustments are explainable.
14. As a project report maintainer, I want changes to names, owners, phase membership, status and dependencies recorded with actor, time and reason, so that the meaning and ownership of an item remain traceable.
15. As a project report maintainer, I want to see the original plan alongside the current plan or actual result, so that repeated rescheduling does not conceal total delay.
16. As a report reader, I want variance measured against the first planned date, so that I can understand the full movement from the initial commitment.
17. As a project report maintainer, I want to make a phase, task or milestone depend on another item in the same project, so that the delivery sequence is explicit.
18. As a project report maintainer, I want self-dependencies and circular chains rejected, so that dependency warnings have a usable meaning.
19. As a project report maintainer, I want a warning when a successor starts while its predecessor is incomplete, so that exceptional parallel work is visible but can continue.
20. As a project report maintainer, I want a warning when a predecessor's schedule slips, so that I can assess affected successors without the system changing their dates.
21. As a project report maintainer, I want to link an external dependency record to affected project items, so that an outside delivery is visible without creating a false internal task.
22. As an authorized participating section head or task owner, I want to provide progress and proposed schedule changes, so that the maintainer can decide whether to update the project's commitments; the maintainer records reports from owners without an account and identifies the source.
23. As a project report maintainer, I want to link selected eCIM work to a key task, so that source details support the reported progress without replacing the maintained plan.
24. As a project report maintainer, I want to cancel an item with a reason while keeping its history, so that abandoned work remains explainable.
25. As a project report maintainer, I want to resolve every successor dependency before cancelling its predecessor, so that no active item silently treats cancellation as completion.
26. As a project report maintainer, I want to discard an uncommitted private schedule draft created in error, so that every committed schedule item retains its creation and later history.
27. As a meeting reader, I want the Gantt view to start with phases and milestones and let me expand key tasks, so that I can scan major dates before inspecting details.
28. As a meeting reader, I want cancelled items hidden by default but retrievable, so that the active schedule stays clear without losing context.
29. As a meeting reader, I want the published report to preserve the dates, statuses, dependencies and warnings as of publication, so that a fixed publication link never changes later.
30. As a project report maintainer, I want a later weekly draft to continue the project's schedule and history, so that open commitments do not have to be re-entered.
31. As a project report maintainer, I want a stale edit to return the current version rather than overwrite another change, so that concurrent editors can reconcile safely.
32. As a project report maintainer, I want to correct an original-plan data-entry error with an explicit reason and preserved first entry, so that variance uses the corrected initial commitment without disguising replanning.
33. As a meeting reader, I want to inspect schedule revisions and linked eCIM evidence as they stood when a report was published, so that a fixed publication remains explainable later.

## Implementation Decisions

- Use the existing project item as the aggregate boundary. The API for project schedule reads and writes is the highest practical seam for phases, key tasks, milestones, dependency checks, history and authorization. Every schedule write requires the project item's active edit lease and base project version; the transaction checks both, increments the project version and returns the latest project schedule on a stale-version conflict.
- Represent phase, key task and milestone as distinct kinds with kind-specific validation and presentation. Do not expose a start/end range for milestones. Preserve one stable identity per item so dependencies, history, source links and publication snapshots can refer to it.
- A phase has planned start and end dates, actual start and completion dates, and an explicit lifecycle state: open, in progress, completed or cancelled. A key task has the same date and state shape plus a required owner; its phase membership is optional and limited to a phase in the same project. Planned start must not follow planned end, and actual start must not follow actual completion. An open phase or task has no current actual dates; an in-progress one has an actual start but no completion date. Completing a phase or task requires both actual start and completion dates; the maintainer may enter both retrospectively in one revision. Reopening a completed item clears its current completion date but preserves the previous value in revision history; it becomes in progress when it retains an actual start, otherwise open.
- A milestone requires one target date on creation and has pending, achieved or cancelled state. Preserve its original target, latest target and actual achievement date as separate values. While pending, its primary point marker uses the latest target; marking it achieved requires an actual achievement date and uses that date as the primary marker while retaining the latest target for comparison. Reopening an achieved milestone returns it to pending and clears the current achievement date but preserves the earlier value in revision history. A past target date never changes status on its own.
- Preserve the first entered planned date or range in the creation event. The effective original plan is the first agreed commitment and normally remains fixed; an explicit original-data-correction operation may change it only to correct a mistaken entry, with actor, reason and before/after values retained. Ordinary rescheduling changes the current plan, not the effective original plan. Calculate variance from the effective original date or range: start-to-start and end-to-end for phases/tasks, and original target-to-current target or achievement for milestones. Do not reset total variance after rescheduling.
- Require a nonblank reason for every post-creation change to a schedule item, including date corrections, completion or reopening, name and owner changes, phase membership, dependency changes and cancellation. Save one atomic revision containing actor, timestamp, action, reason, before state and after state. A creation event preserves the original plan. History is append-only and visible to authorized readers.
- Completion is explicit. For phases and tasks, the maintainer records actual start when work starts and actual completion when confirming completion. Phase completion is not inferred from child tasks. The maintainer may confirm a phase while child tasks remain incomplete; show those tasks as a warning and require the confirmation reason to explain the exception. Corrections and reopening create new revisions rather than editing or deleting previous revisions.
- Support one directed, same-project, advisory finish-to-start predecessor relation between schedule items, with multiple predecessors or successors per item. Reject self-links, cycles, cross-project references and links between a phase and its direct child task. Parent phase membership does not itself create a dependency.
- Distinguish a predecessor plan-change notice from a sequence-conflict warning. A predecessor plan change is visible to affected successors even when their dates remain feasible; show a sequence conflict when the predecessor's current planned or actual finish is later than the successor's planned or actual start. Same-day completion and start are allowed. Warn while a successor has started and a predecessor remains unfinished; clear that live warning when the predecessor completes. If actual dates show that the successor started before its predecessor finished, retain the historical sequence-conflict warning while the link remains, until a recorded date correction resolves it. Removing the link clears its warning from the current view but preserves the link removal and prior conflict in revision history and earlier publications. Warnings do not block work or mutate successor dates. Freeze the evaluated warnings in each publication snapshot so a fixed publication never changes as time passes; cancellation does not count as completion.
- Before cancelling a predecessor with active successors, require the maintainer to replace or remove each affected link, recording reasons and revisions. Detach any remaining incoming dependency links when an item is cancelled, preserving their removal in history; a cancelled item has no active dependency links. Before cancelling a phase, require every child task to be reassigned to another phase, moved directly under the project or cancelled in its own recorded revision. An uncommitted private schedule draft may be discarded. Once a schedule item has a creation event, it cannot be hard-deleted; use cancellation with a reason.
- Allow reactivation of a cancelled item with a reason and a new revision. Do not automatically restore child membership or dependency links removed during cancellation; any links the maintainer adds must pass current same-project, parent-child and cycle validation. A reactivated phase or task returns to in progress if it retains an actual start, otherwise open; a reactivated milestone returns to pending.
- Keep external work in the existing cross-department dependency record type, with optional links to affected same-project schedule items. Store owner or supplying unit, due date and status on that external record. Show an overdue or unfinished external-delivery notice on linked schedule items separately from internal predecessor warnings; do not include external records in internal cycle or sequence checks.
- A key-task owner is required but may be a person or unit without a local user account. Assignment does not grant edit rights. The project report maintainer edits schedule commitments and completion states; authorized participating section heads and task owners with accounts provide updates and proposals through the existing collaboration path. The maintainer records an external owner's report and identifies its source. Apply existing project read permissions to schedule and history views.
- Link selected eCIM work to key tasks by explicit maintainer action. Keep a stable eCIM work identity across weekly reports and preserve the source content used at each reference or synchronization. Allow multiple supporting work records. A publication uses the source evidence captured by publication time; later synchronization cannot change that evidence, create, reschedule, complete or cancel a key task automatically.
- Render phases as time spans and milestones as point markers. Show key tasks in an expandable project-detail view rather than cluttering the default Gantt. Show original plan, current plan or actual result, variance, status and dependency warnings. Cancelled entries are hidden in the default view but accessible in a separate view.
- Include the full schedule state, its links, evaluated warnings, revision history, linked source evidence and the values needed to interpret variance in immutable publication snapshots. Authorized publication readers may inspect the revisions and evidence as of publication. Later edits affect working drafts and subsequent publications only. At new-week creation, copy the prior latest published state into an independent working version; later edits or republications of the prior week do not silently alter it. For an ongoing project, continue its full schedule graph across weeks, including completed and cancelled items, stable logical schedule identities, dependency links and revision history; default views may hide cancelled items.
- Because the project has not been published, replace the existing schedule representation directly; no legacy schedule-data conversion is required. Other report data and the existing immutable-publication contract remain in scope for preservation.

## Delivery Sequence

- Phase 1: deliver the three schedule kinds, their data and edit forms, lifecycle rules, complete revision history, internal and external dependency links and warnings, weekly continuation and immutable publication snapshots. The schedule must be complete and auditable before a report using it is published.
- Phase 2: add the Gantt presentation and manually selected eCIM work links. Source synchronization remains unable to change schedule commitments. Preserve the Phase 1 schedule and publication contract when adding these views and links.

## Testing Decisions

- Prefer one high-level integration seam: authenticated HTTP requests against the API with a temporary SQLite database, following the existing smoke-test approach. Verify observable responses, history, publication snapshots and persisted behavior, not private validation helpers or table names.
- Cover creation and kind-specific validation: required milestone date; required task owner and planned start/end; phase and task date ordering; optional task phase membership; and rejection of membership outside the project.
- Cover milestone rescheduling, original-date variance, achievement, overdue-but-unachieved behavior, correction and reopening. Verify that the latest target remains available after achievement and that the UI and published output never render a milestone as a date range.
- Cover phase and task actual start/completion, including retrospective entry of both dates, explicit phase acceptance with unfinished-child warning and reason, reopening, cancellation and reactivation without automatic restoration of links, and no automatic phase completion.
- Cover revision requirements and retrieval for every editable field, including rejected reasonless changes, complete before/after values, actor and time, stale versions, preserved first-entered plan, corrected effective original plan and ordinary rescheduling that leaves that reference unchanged.
- Cover dependencies across all item kinds, multiple predecessors, same-project enforcement, cycle and parent-child link rejection, live versus historical warnings, warning removal after a link is removed, no automatic date change and the ability to proceed despite warnings. Verify external-delivery notices are separate from internal dependency checks.
- Cover cancellation requiring successor-link and child-task resolution; verify cancelled predecessors never satisfy dependencies and committed items cannot be hard-deleted.
- Cover authorization for maintainers, participating section heads, unrelated users and readers. Verify that task ownership alone does not grant schedule-edit permission and that eCIM refresh does not change commitments.
- Cover published snapshots and next-week continuation through the existing report API, checking frozen warnings, revision history and eCIM evidence and that earlier fixed versions retain their original schedule after later edits. Verify stable logical schedule identities, history, dependencies and source links after continuation, and independence from later changes to a prior week's working version.
- Add focused browser coverage for the date-form variants, history and reason entry, dependency warnings, task expansion, milestone point markers and cancelled-item visibility. These tests should exercise user-visible flows rather than CSS or component internals.

## Out of Scope

- Full project task management, automatic creation of every engineer work item, time tracking, effort estimates and completion percentage derived from hours.
- Automatic date propagation, critical-path calculation or hard blocking of work when a predecessor is incomplete.
- Cross-project schedule links; external dependencies use management records and affected-item links instead.
- Time-of-day precision for milestone targets or achievement.
- Migration of existing experimental schedule data or old JSON/HTML report files.

## Further Notes

- The domain glossary, solution design and broad implementation spec now reflect this schedule model. Update the report structure, implementation plan and README when implementing the change; those documents still describe shared phase/milestone date ranges or baseline-only history.
- Preserve the accepted decisions to use one ASP.NET Core service with SQLite and to publish immutable report snapshots. The existing working tree contains unrelated edits; implementation should not overwrite them.
