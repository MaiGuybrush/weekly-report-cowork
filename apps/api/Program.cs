using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.FileProviders;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Services.AddSingleton<Store>();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<JwtVerifier>();
builder.Services.AddHttpClient<EcimClient>();
builder.Services.AddCors(options => options.AddPolicy("web", policy =>
{
    var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
    policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
}));
var app = builder.Build();
app.Services.GetRequiredService<Store>().Initialize();
var webRoot = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "../web/dist/weekly-report-web/browser"));
if (Directory.Exists(webRoot))
{
    var files = new PhysicalFileProvider(webRoot);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
    app.UseStaticFiles(new StaticFileOptions
    {
        FileProvider = files,
        OnPrepareResponse = context =>
        {
            if (context.Context.Request.Path.Equals("/assets/config.json", StringComparison.OrdinalIgnoreCase))
                context.Context.Response.Headers.CacheControl = "no-cache";
        }
    });
}

app.MapGet("/api/health", () => Results.Ok(new { status = "ok" }));

app.UseCors("web");

app.Use(async (context, next) =>
{
    if (context.Request.Path.StartsWithSegments("/api/health")) { await next(); return; }
    if (!context.Request.Path.StartsWithSegments("/api")) { await next(); return; }
    var empNo = await context.RequestServices.GetRequiredService<JwtVerifier>().Verify(context.Request.Headers.Authorization);
    if (empNo is null) { context.Response.StatusCode = 401; return; }
    using var db = context.RequestServices.GetRequiredService<Store>().Open();
    using var cmd = Store.Sql(db, "SELECT emp_no,name,role,section,reader_access FROM users WHERE emp_no=$id COLLATE NOCASE", ("$id", empNo));
    using var row = cmd.ExecuteReader();
    if (!row.Read()) { context.Response.StatusCode = 403; return; }
    context.Items["user"] = new User(row.GetString(0), row.GetString(1), row.GetString(2), row.IsDBNull(3) ? null : row.GetString(3), row.GetInt32(4) == 1);
    await next();
});

app.MapGet("/api/me", (HttpContext ctx) => Results.Ok(Current(ctx)));
app.MapPost("/api/access/users", (HttpContext ctx, Store store, AccessUserRequest request) =>
{
    if (Current(ctx).Role != "Guy") return Results.StatusCode(403);
    if (string.IsNullOrWhiteSpace(request.EmpNo) || string.IsNullOrWhiteSpace(request.Name) || request.Role is not ("Guy" or "Head" or "Reader") || request.EmpNo.Length > 100 || request.Name.Length > 200)
        return Results.BadRequest();
    if (request.Role == "Head" && string.IsNullOrWhiteSpace(request.Section)) return Results.BadRequest(new { error = "section required for Head" });
    if (request.Role != "Head" && request.Section is not null) return Results.BadRequest(new { error = "section is only valid for Head" });
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var beforeRole = Store.Sql(db, "SELECT role FROM users WHERE emp_no=$id COLLATE NOCASE", ("$id", request.EmpNo.Trim())).ExecuteScalar() as string;
    var beforeReaderAccess = Convert.ToInt32(Store.Sql(db, "SELECT COALESCE(reader_access,0) FROM users WHERE emp_no=$id COLLATE NOCASE", ("$id", request.EmpNo.Trim())).ExecuteScalar() ?? 0) == 1;
    var readerAccess = request.ReaderAccess ?? (request.Role == "Reader" || beforeReaderAccess);
    Store.Sql(db, "INSERT INTO users(emp_no,name,role,section,reader_access) VALUES($id,$name,$role,$section,$reader) ON CONFLICT(emp_no) DO UPDATE SET name=excluded.name,role=excluded.role,section=excluded.section,reader_access=excluded.reader_access",
        ("$id", request.EmpNo.Trim()), ("$name", request.Name.Trim()), ("$role", request.Role), ("$section", request.Section?.Trim()), ("$reader", readerAccess ? 1 : 0)).ExecuteNonQuery();
    Store.Sql(db, "INSERT INTO access_audit(actor,target_emp_no,at,action,before_role,after_role,before_reader_access,after_reader_access) VALUES($actor,$target,$at,'upsert',$before,$after,$beforeReader,$afterReader)",
        ("$actor", Current(ctx).EmpNo), ("$target", request.EmpNo.Trim()), ("$at", DateTimeOffset.UtcNow.ToString("O")), ("$before", beforeRole), ("$after", request.Role), ("$beforeReader", beforeReaderAccess ? 1 : 0), ("$afterReader", readerAccess ? 1 : 0)).ExecuteNonQuery();
    tx.Commit();
    return Results.Ok(new { readerAccess });
});
app.MapGet("/api/access/audit", (HttpContext ctx, Store store) =>
{
    if (Current(ctx).Role != "Guy") return Results.StatusCode(403);
    using var db = store.Open();
    using var rows = Store.Sql(db, "SELECT actor,target_emp_no,at,action,before_role,after_role,before_reader_access,after_reader_access FROM access_audit ORDER BY id DESC").ExecuteReader();
    var entries = new List<object>();
    while (rows.Read()) entries.Add(new { actor = rows.GetString(0), empNo = rows.GetString(1), at = rows.GetString(2), action = rows.GetString(3), beforeRole = rows.IsDBNull(4) ? null : rows.GetString(4), afterRole = rows.GetString(5), beforeReaderAccess = !rows.IsDBNull(6) && rows.GetInt32(6) == 1, afterReaderAccess = rows.GetInt32(7) == 1 });
    return Results.Ok(entries);
});
app.MapGet("/api/reports", (HttpContext ctx, Store store) =>
{
    if (!Editor(Current(ctx))) return Results.StatusCode(403);
    using var db = store.Open();
    using var rows = Store.Sql(db, "SELECT id,meeting_date FROM reports ORDER BY meeting_date DESC").ExecuteReader();
    var reports = new List<object>();
    while (rows.Read()) reports.Add(new { id = rows.GetString(0), meetingDate = rows.GetString(1) });
    return Results.Ok(reports);
});
app.MapPost("/api/reports", (HttpContext ctx, Store store, CreateReport request) =>
{
    if (Current(ctx).Role != "Guy") return Results.StatusCode(403);
    if (!DateOnly.TryParseExact(request.MeetingDate, "yyyy-MM-dd", out _)) return Results.BadRequest(new { error = "meetingDate must be yyyy-MM-dd" });
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var newReportId = Guid.NewGuid().ToString();
    var created = Store.Sql(db, "INSERT INTO reports(id,meeting_date,created_by) VALUES($id,$date,$actor) ON CONFLICT(meeting_date) DO NOTHING",
        ("$id", newReportId), ("$date", request.MeetingDate), ("$actor", Current(ctx).EmpNo)).ExecuteNonQuery() == 1;
    var id = (string)Store.Sql(db, "SELECT id FROM reports WHERE meeting_date=$date", ("$date", request.MeetingDate)).ExecuteScalar()!;
    if (created)
    {
        var snapshot = PreviousPublication(db, request.MeetingDate);
        if (snapshot is not null)
        {
            foreach (var item in snapshot.Items.Where(item => item.Status != "closed"))
            {
                var carriedId = Guid.NewGuid().ToString();
                Store.Sql(db, "INSERT INTO items(id,report_id,continuity_id,section,owner_section,title,content,details,status,version,created_by) VALUES($id,$report,$continuity,$section,$owner,$title,$content,$details,$status,1,$actor)",
                    ("$id", carriedId), ("$report", newReportId), ("$continuity", item.ContinuityId), ("$section", item.Section), ("$owner", item.OwnerSection), ("$title", item.Title), ("$content", item.Content), ("$details", CarryDetails(item)), ("$status", item.Status), ("$actor", Current(ctx).EmpNo)).ExecuteNonQuery();

                using (var pRows = Store.Sql(db, "SELECT section FROM project_participants WHERE project_id=$oldProject", ("$oldProject", item.Id)).ExecuteReader())
                {
                    var parts = new List<string>();
                    while (pRows.Read()) parts.Add(pRows.GetString(0));
                    pRows.Close();
                    foreach (var p in parts)
                    {
                        Store.Sql(db, "INSERT INTO project_participants(project_id,section) VALUES($project,$section) ON CONFLICT DO NOTHING",
                            ("$project", carriedId), ("$section", p)).ExecuteNonQuery();
                    }
                }

                var schedule = item.Schedule ?? [];
                var carriedIds = schedule.ToDictionary(entry => entry.Id, _ => Guid.NewGuid().ToString());

                foreach (var entry in schedule.Where(entry => entry.Kind == "phase").Concat(schedule.Where(entry => entry.Kind != "phase")))
                {
                    var newEntryId = carriedIds[entry.Id];
                    var continuityId = !string.IsNullOrWhiteSpace(entry.ContinuityId) ? entry.ContinuityId : entry.Id;
                    Store.Sql(db, """
                        INSERT INTO project_schedule_entries(
                            id,project_id,continuity_id,kind,name,baseline_start,baseline_end,
                            forecast_start,forecast_end,actual_start,actual_end,state,owner,
                            phase_id,version,created_by,updated_at,baseline_date,forecast_date,actual_date
                        ) VALUES(
                            $id,$project,$continuityId,$kind,$name,$baselineStart,$baselineEnd,
                            $forecastStart,$forecastEnd,$actualStart,$actualEnd,$state,$owner,
                            $phase,$version,$actor,$at,$baselineDate,$forecastDate,$actualDate
                        )
                        """,
                        ("$id", newEntryId), ("$project", carriedId), ("$continuityId", continuityId),
                        ("$kind", entry.Kind), ("$name", entry.Name), ("$baselineStart", entry.BaselineStart),
                        ("$baselineEnd", entry.BaselineEnd), ("$forecastStart", entry.ForecastStart),
                        ("$forecastEnd", entry.ForecastEnd), ("$actualStart", entry.ActualStart),
                        ("$actualEnd", entry.ActualEnd), ("$state", entry.State), ("$owner", entry.Owner),
                        ("$phase", entry.PhaseId is null ? null : carriedIds.GetValueOrDefault(entry.PhaseId)),
                        ("$version", entry.Version), ("$actor", Current(ctx).EmpNo), ("$at", DateTimeOffset.UtcNow.ToString("O")),
                        ("$baselineDate", entry.BaselineDate), ("$forecastDate", entry.ForecastDate),
                        ("$actualDate", entry.ActualDate)).ExecuteNonQuery();

                    if (entry.History is not null && entry.History.Count > 0)
                    {
                        foreach (var rev in entry.History)
                        {
                            Store.Sql(db, """
                                INSERT INTO project_schedule_revisions(entry_id,actor,at,action,reason,before_state,after_state)
                                VALUES($entry,$actor,$at,$action,$reason,$before,$after)
                                """,
                                ("$entry", newEntryId), ("$actor", rev.Actor), ("$at", rev.At),
                                ("$action", rev.Action), ("$reason", rev.Reason),
                                ("$before", rev.Before is null ? null : System.Text.Json.JsonSerializer.Serialize(rev.Before)),
                                ("$after", rev.After is null ? "{}" : System.Text.Json.JsonSerializer.Serialize(rev.After))).ExecuteNonQuery();
                        }
                    }
                    else
                    {
                        using var revRows = Store.Sql(db, "SELECT actor,at,action,reason,before_state,after_state FROM project_schedule_revisions WHERE entry_id=$oldId ORDER BY id", ("$oldId", entry.Id)).ExecuteReader();
                        var revList = new List<(string actor, string at, string action, string? reason, string? before, string after)>();
                        while (revRows.Read())
                        {
                            revList.Add((revRows.GetString(0), revRows.GetString(1), revRows.GetString(2), NullableString(revRows, 3), NullableString(revRows, 4), revRows.GetString(5)));
                        }
                        revRows.Close();
                        foreach (var r in revList)
                        {
                            Store.Sql(db, """
                                INSERT INTO project_schedule_revisions(entry_id,actor,at,action,reason,before_state,after_state)
                                VALUES($entry,$actor,$at,$action,$reason,$before,$after)
                                """,
                                ("$entry", newEntryId), ("$actor", r.actor), ("$at", r.at),
                                ("$action", r.action), ("$reason", r.reason), ("$before", r.before),
                                ("$after", r.after)).ExecuteNonQuery();
                        }
                    }

                    using (var bRows = Store.Sql(db, "SELECT actor,at,before_baseline_start,before_baseline_end,after_baseline_start,after_baseline_end,reason FROM project_baseline_history WHERE entry_id=$oldId ORDER BY id", ("$oldId", entry.Id)).ExecuteReader())
                    {
                        var bList = new List<(string actor, string at, string? bsStart, string? bsEnd, string? asStart, string? asEnd, string reason)>();
                        while (bRows.Read())
                        {
                            bList.Add((bRows.GetString(0), bRows.GetString(1), NullableString(bRows, 2), NullableString(bRows, 3), NullableString(bRows, 4), NullableString(bRows, 5), bRows.GetString(6)));
                        }
                        bRows.Close();
                        foreach (var b in bList)
                        {
                            Store.Sql(db, """
                                INSERT INTO project_baseline_history(entry_id,actor,at,before_baseline_start,before_baseline_end,after_baseline_start,after_baseline_end,reason)
                                VALUES($entry,$actor,$at,$bsStart,$bsEnd,$asStart,$asEnd,$reason)
                                """,
                                ("$entry", newEntryId), ("$actor", b.actor), ("$at", b.at),
                                ("$bsStart", b.bsStart), ("$bsEnd", b.bsEnd), ("$asStart", b.asStart),
                                ("$asEnd", b.asEnd), ("$reason", b.reason)).ExecuteNonQuery();
                        }
                    }
                }

                using (var depRows = Store.Sql(db, "SELECT predecessor_id, successor_id, created_by, created_at, reason FROM project_schedule_dependencies WHERE project_id=$oldProject", ("$oldProject", item.Id)).ExecuteReader())
                {
                    var depList = new List<(string pred, string succ, string actor, string at, string reason)>();
                    while (depRows.Read())
                    {
                        var p = depRows.GetString(0);
                        var s = depRows.GetString(1);
                        if (carriedIds.ContainsKey(p) && carriedIds.ContainsKey(s))
                        {
                            depList.Add((carriedIds[p], carriedIds[s], depRows.GetString(2), depRows.GetString(3), depRows.GetString(4)));
                        }
                    }
                    depRows.Close();
                    foreach (var dep in depList)
                    {
                        Store.Sql(db, """
                            INSERT INTO project_schedule_dependencies(id,project_id,predecessor_id,successor_id,created_by,created_at,reason)
                            VALUES($id,$project,$pred,$succ,$actor,$at,$reason)
                            ON CONFLICT(predecessor_id, successor_id) DO NOTHING
                            """,
                            ("$id", Guid.NewGuid().ToString()), ("$project", carriedId),
                            ("$pred", dep.pred), ("$succ", dep.succ),
                            ("$actor", dep.actor), ("$at", dep.at), ("$reason", dep.reason)).ExecuteNonQuery();
                    }
                }

                foreach (var entry in schedule)
                {
                    if (entry.Predecessors is not null)
                    {
                        foreach (var p in entry.Predecessors)
                        {
                            if (carriedIds.TryGetValue(p.Id, out var newPredId) && carriedIds.TryGetValue(entry.Id, out var newSuccId))
                            {
                                Store.Sql(db, """
                                    INSERT INTO project_schedule_dependencies(id,project_id,predecessor_id,successor_id,created_by,created_at,reason)
                                    VALUES($id,$project,$pred,$succ,$actor,$at,$reason)
                                    ON CONFLICT(predecessor_id, successor_id) DO NOTHING
                                    """,
                                    ("$id", Guid.NewGuid().ToString()), ("$project", carriedId),
                                    ("$pred", newPredId), ("$succ", newSuccId),
                                    ("$actor", Current(ctx).EmpNo), ("$at", DateTimeOffset.UtcNow.ToString("O")),
                                    ("$reason", "跨週延續內部前置相依")).ExecuteNonQuery();
                            }
                        }
                    }
                }

                var externalDeps = item.ExternalDependencies ?? [];
                var carriedDepIds = externalDeps.ToDictionary(dep => dep.Id, _ => Guid.NewGuid().ToString());
                foreach (var dep in externalDeps)
                {
                    var newDepId = carriedDepIds[dep.Id];
                    Store.Sql(db, """
                        INSERT INTO project_external_dependencies(id,project_id,description,supplier,due_date,status,created_by,created_at,updated_at)
                        VALUES($id,$project,$desc,$supplier,$dueDate,$status,$actor,$createdAt,$updatedAt)
                        """,
                        ("$id", newDepId), ("$project", carriedId), ("$desc", dep.Description),
                        ("$supplier", dep.Supplier), ("$dueDate", dep.DueDate), ("$status", dep.Status),
                        ("$actor", dep.CreatedBy), ("$createdAt", dep.CreatedAt), ("$updatedAt", dep.UpdatedAt)).ExecuteNonQuery();

                    foreach (var h in dep.History ?? [])
                    {
                        Store.Sql(db, """
                            INSERT INTO project_external_dependency_history(external_dependency_id,actor,at,action,reason,schedule_entry_id,schedule_entry_name)
                            VALUES($depId,$actor,$at,$action,$reason,$schedId,$schedName)
                            """,
                            ("$depId", newDepId), ("$actor", h.Actor), ("$at", h.At),
                            ("$action", h.Action), ("$reason", h.Reason),
                            ("$schedId", h.ScheduleEntryId is not null && carriedIds.ContainsKey(h.ScheduleEntryId) ? carriedIds[h.ScheduleEntryId] : null),
                            ("$schedName", h.ScheduleEntryName)).ExecuteNonQuery();
                    }

                    foreach (var link in dep.LinkedScheduleEntries ?? [])
                    {
                        if (carriedIds.TryGetValue(link.ScheduleEntryId, out var newSchedEntryId))
                        {
                            var linkInfo = Store.Sql(db, "SELECT created_by,created_at,reason FROM project_external_dependency_links WHERE external_dependency_id=$oldDep AND schedule_entry_id=$oldSched", ("$oldDep", dep.Id), ("$oldSched", link.ScheduleEntryId)).ExecuteReader();
                            string lActor = dep.CreatedBy;
                            string lAt = dep.CreatedAt;
                            string lReason = "延續跨部門相依關聯";
                            if (linkInfo.Read())
                            {
                                lActor = linkInfo.GetString(0);
                                lAt = linkInfo.GetString(1);
                                lReason = linkInfo.GetString(2);
                            }
                            linkInfo.Close();

                            Store.Sql(db, """
                                INSERT INTO project_external_dependency_links(id,project_id,external_dependency_id,schedule_entry_id,created_by,created_at,reason)
                                VALUES($id,$project,$depId,$schedId,$actor,$at,$reason)
                                ON CONFLICT(external_dependency_id, schedule_entry_id) DO NOTHING
                                """,
                                ("$id", Guid.NewGuid().ToString()), ("$project", carriedId),
                                ("$depId", newDepId), ("$schedId", newSchedEntryId),
                                ("$actor", lActor), ("$at", lAt), ("$reason", lReason)).ExecuteNonQuery();
                        }
                    }
                }

                using (var evRows = Store.Sql(db, """
                    SELECT schedule_entry_id, work_id, section, summary, period_from, period_to, initial_payload, latest_payload, created_by, created_at, reason
                    FROM project_schedule_evidence_links
                    WHERE project_id=$oldProject
                    ORDER BY rowid
                    """, ("$oldProject", item.Id)).ExecuteReader())
                {
                    var evList = new List<(string oldSchedId, string workId, string? sec, string sum, string? pFrom, string? pTo, string initP, string latestP, string actor, string at, string reason)>();
                    while (evRows.Read())
                    {
                        var oldSched = evRows.GetString(0);
                        if (carriedIds.ContainsKey(oldSched))
                        {
                            evList.Add((
                                oldSched,
                                evRows.GetString(1),
                                NullableString(evRows, 2),
                                evRows.GetString(3),
                                NullableString(evRows, 4),
                                NullableString(evRows, 5),
                                evRows.GetString(6),
                                evRows.GetString(7),
                                evRows.GetString(8),
                                evRows.GetString(9),
                                evRows.GetString(10)
                            ));
                        }
                    }
                    evRows.Close();

                    foreach (var ev in evList)
                    {
                        var newSchedId = carriedIds[ev.oldSchedId];
                        Store.Sql(db, """
                            INSERT INTO project_schedule_evidence_links(id,project_id,schedule_entry_id,work_id,source_id,section,summary,period_from,period_to,initial_payload,latest_payload,created_by,created_at,updated_at,reason)
                            VALUES($id,$project,$sched,$work,NULL,$sec,$sum,$pFrom,$pTo,$init,$latest,$actor,$at,$updatedAt,$reason)
                            ON CONFLICT(schedule_entry_id, work_id) DO NOTHING
                            """,
                            ("$id", Guid.NewGuid().ToString()), ("$project", carriedId),
                            ("$sched", newSchedId), ("$work", ev.workId),
                            ("$sec", ev.sec), ("$sum", ev.sum),
                            ("$pFrom", ev.pFrom), ("$pTo", ev.pTo),
                            ("$init", ev.initP), ("$latest", ev.latestP),
                            ("$actor", ev.actor), ("$at", ev.at),
                            ("$updatedAt", DateTimeOffset.UtcNow.ToString("O")),
                            ("$reason", ev.reason)).ExecuteNonQuery();
                    }
                }

                foreach (var entry in schedule)
                {
                    if (entry.EvidenceLinks is not null)
                    {
                        foreach (var ev in entry.EvidenceLinks)
                        {
                            if (carriedIds.TryGetValue(entry.Id, out var newSchedId))
                            {
                                Store.Sql(db, """
                                    INSERT INTO project_schedule_evidence_links(id,project_id,schedule_entry_id,work_id,source_id,section,summary,period_from,period_to,initial_payload,latest_payload,created_by,created_at,updated_at,reason)
                                    VALUES($id,$project,$sched,$work,NULL,$sec,$sum,$pFrom,$pTo,$init,$latest,$actor,$at,$updatedAt,$reason)
                                    ON CONFLICT(schedule_entry_id, work_id) DO NOTHING
                                    """,
                                    ("$id", Guid.NewGuid().ToString()), ("$project", carriedId),
                                    ("$sched", newSchedId), ("$work", ev.WorkId),
                                    ("$sec", ev.Section), ("$sum", ev.Summary),
                                    ("$pFrom", ev.PeriodFrom), ("$pTo", ev.PeriodTo),
                                    ("$init", ev.InitialPayload), ("$latest", ev.LatestPayload),
                                    ("$actor", ev.CreatedBy), ("$at", ev.CreatedAt),
                                    ("$updatedAt", DateTimeOffset.UtcNow.ToString("O")),
                                    ("$reason", ev.Reason)).ExecuteNonQuery();
                            }
                        }
                    }
                }
            }
        }
    }
    tx.Commit();
    return Results.Ok(new { id, request.MeetingDate, sections = ReportSections.All });
});
app.MapPost("/api/reports/{reportId}/ecim-sync", async (HttpContext ctx, Store store, EcimClient ecim, IConfiguration config, string reportId, CancellationToken cancellationToken) =>
{
    var user = Current(ctx);
    if (user.Role != "Head" || string.IsNullOrWhiteSpace(user.Section)) return Results.StatusCode(403);
    var members = EcimMembers(config).Where(member => member.Section == user.Section).ToList();
    if (members.Count == 0) return Results.BadRequest(new { error = "No eCIM members configured for this section" });
    using var db = store.Open();
    if (Store.Sql(db, "SELECT 1 FROM reports WHERE id=$id", ("$id", reportId)).ExecuteScalar() is null) return Results.NotFound();
    var runId = Guid.NewGuid().ToString();
    var startedAt = DateTimeOffset.UtcNow.ToString("O");
    var periodFrom = members.Select(member => member.UpdateDateFrom).Where(value => !string.IsNullOrWhiteSpace(value)).Min();
    var periodTo = members.Select(member => member.UpdateDateTo).Where(value => !string.IsNullOrWhiteSpace(value)).Max();
    Store.Sql(db, "INSERT INTO ecim_import_runs(id,report_id,section,period_from,period_to,started_at,status) VALUES($id,$report,$section,$from,$to,$at,'running')", ("$id", runId), ("$report", reportId), ("$section", user.Section), ("$from", periodFrom), ("$to", periodTo), ("$at", startedAt)).ExecuteNonQuery();
    var results = new List<SyncMemberResult>();
    foreach (var member in members)
    {
        try
        {
            var work = await ecim.ReviewWork(member, cancellationToken);
            var succeededAt = DateTimeOffset.UtcNow.ToString("O");
            using var tx = db.BeginTransaction();
            foreach (var entry in work)
            {
                var sourceId = Store.Sql(db, "SELECT id FROM ecim_sources WHERE report_id=$report AND work_id=$work AND period_from=$from AND period_to=$to", ("$report", reportId), ("$work", entry.WorkId), ("$from", member.UpdateDateFrom ?? ""), ("$to", member.UpdateDateTo ?? "")).ExecuteScalar() as string;
                if (sourceId is null)
                {
                    sourceId = Guid.NewGuid().ToString();
                    Store.Sql(db, "INSERT INTO ecim_sources(id,report_id,section,work_id,period_from,period_to,payload,import_run_id) VALUES($id,$report,$section,$work,$from,$to,$payload,$run)", ("$id", sourceId), ("$report", reportId), ("$section", user.Section), ("$work", entry.WorkId), ("$from", member.UpdateDateFrom ?? ""), ("$to", member.UpdateDateTo ?? ""), ("$payload", entry.Payload), ("$run", runId)).ExecuteNonQuery();
                    Store.Sql(db, "INSERT INTO ecim_candidates(id,report_id,source_id,section,candidate_type,reason) VALUES($id,$report,$source,$section,'new-source','新增來源')", ("$id", Guid.NewGuid().ToString()), ("$report", reportId), ("$source", sourceId), ("$section", user.Section)).ExecuteNonQuery();
                }
                else
                {
                    var previous = Store.Sql(db, "SELECT payload FROM ecim_sources WHERE id=$id", ("$id", sourceId)).ExecuteScalar() as string;
                    if (previous != entry.Payload)
                    {
                        var classification = CandidateClassification(entry.Payload);
                        Store.Sql(db, "UPDATE ecim_sources SET payload=$payload,import_run_id=$run WHERE id=$id", ("$payload", entry.Payload), ("$run", runId), ("$id", sourceId)).ExecuteNonQuery();
                        Store.Sql(db, "UPDATE ecim_candidates SET status='new',candidate_type=$type,reason=$reason,decided_by=NULL,decided_at=NULL WHERE source_id=$source", ("$type", classification.Type), ("$reason", classification.Reason), ("$source", sourceId)).ExecuteNonQuery();
                        var targetItemId = Store.Sql(db, "SELECT target_item_id FROM ecim_candidates WHERE source_id=$source", ("$source", sourceId)).ExecuteScalar() as string;
                        if (!string.IsNullOrWhiteSpace(targetItemId))
                        {
                            var origin = GetFieldOrigin(db, targetItemId);
                            var target = GetItem(db, targetItemId);
                            if (origin is not null && target is not null) UpsertFieldOrigin(db, targetItemId, origin.LatestSourceValue, entry.Payload, target.Content, origin.HumanOverride);
                        }
                    }
                }
                Store.Sql(db, """
                    UPDATE project_schedule_evidence_links
                    SET latest_payload=$payload, source_id=$sourceId, updated_at=$at
                    WHERE work_id=$work AND project_id IN (SELECT id FROM items WHERE report_id=$report)
                    """,
                    ("$payload", entry.Payload),
                    ("$sourceId", sourceId),
                    ("$at", succeededAt),
                    ("$work", entry.WorkId),
                    ("$report", reportId)).ExecuteNonQuery();
            }
            Store.Sql(db, "INSERT INTO ecim_member_results(run_id,user_id,status,work_count,last_success_at) VALUES($run,$user,'succeeded',$count,$at)", ("$run", runId), ("$user", member.UserId), ("$count", work.Count), ("$at", succeededAt)).ExecuteNonQuery();
            Store.Sql(db, "INSERT INTO ecim_member_sync_state(section,user_id,last_success_at) VALUES($section,$user,$at) ON CONFLICT(section,user_id) DO UPDATE SET last_success_at=excluded.last_success_at", ("$section", user.Section), ("$user", member.UserId), ("$at", succeededAt)).ExecuteNonQuery();
            tx.Commit();
            results.Add(new SyncMemberResult(member.UserId, "succeeded", work.Count, succeededAt, null));
        }
        catch (Exception exception)
        {
            var error = exception.Message.Length > 500 ? exception.Message[..500] : exception.Message;
            Store.Sql(db, "INSERT INTO ecim_member_results(run_id,user_id,status,error) VALUES($run,$user,'failed',$error)", ("$run", runId), ("$user", member.UserId), ("$error", error)).ExecuteNonQuery();
            results.Add(new SyncMemberResult(member.UserId, "failed", 0, null, error));
        }
    }
    var status = results.Any(result => result.Status == "failed") ? "partial" : "succeeded";
    Store.Sql(db, "UPDATE ecim_import_runs SET finished_at=$at,status=$status WHERE id=$id", ("$at", DateTimeOffset.UtcNow.ToString("O")), ("$status", status), ("$id", runId)).ExecuteNonQuery();
    return Results.Ok(new { id = runId, section = user.Section, status, periodFrom, periodTo, memberResults = results });
});
app.MapGet("/api/reports/{reportId}/ecim-sync", (HttpContext ctx, Store store, IConfiguration config, string reportId) =>
{
    var user = Current(ctx);
    if (user.Role != "Head" || string.IsNullOrWhiteSpace(user.Section)) return Results.StatusCode(403);
    using var db = store.Open();
    if (Store.Sql(db, "SELECT 1 FROM reports WHERE id=$id", ("$id", reportId)).ExecuteScalar() is null) return Results.NotFound();
    var members = new List<object>();
    foreach (var member in EcimMembers(config).Where(member => member.Section == user.Section))
    {
        using var latest = Store.Sql(db, "SELECT mr.status,mr.error,r.period_from,r.period_to FROM ecim_member_results mr JOIN ecim_import_runs r ON r.id=mr.run_id WHERE r.report_id=$report AND r.section=$section AND mr.user_id=$user ORDER BY mr.id DESC LIMIT 1", ("$report", reportId), ("$section", user.Section), ("$user", member.UserId)).ExecuteReader();
        var hasLatest = latest.Read();
        var status = hasLatest ? latest.GetString(0) : "not-run";
        var error = hasLatest && !latest.IsDBNull(1) ? latest.GetString(1) : null;
        var periodFrom = hasLatest && !latest.IsDBNull(2) ? latest.GetString(2) : member.UpdateDateFrom;
        var periodTo = hasLatest && !latest.IsDBNull(3) ? latest.GetString(3) : member.UpdateDateTo;
        latest.Close();
        var lastSuccessAt = Store.Sql(db, "SELECT last_success_at FROM ecim_member_sync_state WHERE section=$section AND user_id=$user", ("$section", user.Section), ("$user", member.UserId)).ExecuteScalar() as string;
        members.Add(new { userId = member.UserId, periodFrom, periodTo, status, error, lastSuccessAt });
    }
    return Results.Ok(new { section = user.Section, members });
});
app.MapGet("/api/reports/{reportId}/ecim-candidates", (HttpContext ctx, Store store, string reportId) =>
{
    var user = Current(ctx);
    if (user.Role != "Head" || string.IsNullOrWhiteSpace(user.Section)) return Results.StatusCode(403);
    using var db = store.Open();
    using var rows = Store.Sql(db, "SELECT c.id,c.status,c.candidate_type,c.reason,c.target_item_id,s.work_id,s.period_from,s.period_to,s.payload,f.last_source_value,f.latest_source_value,f.report_value,f.human_override FROM ecim_candidates c JOIN ecim_sources s ON s.id=c.source_id LEFT JOIN field_origins f ON f.item_id=c.target_item_id AND f.field_name='content' WHERE c.report_id=$report AND c.section=$section ORDER BY s.rowid", ("$report", reportId), ("$section", user.Section)).ExecuteReader();
    var candidates = new List<object>();
    while (rows.Read()) candidates.Add(new { id = rows.GetString(0), status = rows.GetString(1), type = rows.GetString(2), reason = NullableString(rows, 3), targetItemId = NullableString(rows, 4), workId = rows.GetString(5), periodFrom = rows.GetString(6), periodTo = rows.GetString(7), source = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(rows.GetString(8)), lastSourceValue = NullableString(rows, 9), latestSourceValue = NullableString(rows, 10), reportValue = NullableString(rows, 11), humanOverride = !rows.IsDBNull(12) && rows.GetInt32(12) == 1 });
    return Results.Ok(candidates);
});
app.MapPost("/api/reports/{reportId}/ecim-candidates/{candidateId}/decision", (HttpContext ctx, Store store, string reportId, string candidateId, CandidateDecisionRequest request) =>
{
    var user = Current(ctx);
    if (user.Role != "Head" || string.IsNullOrWhiteSpace(user.Section) || request.Action is not ("create" or "merge" or "defer" or "ignore" or "keep-manual" or "apply-source")) return Results.StatusCode(403);
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    using var rows = Store.Sql(db, "SELECT c.source_id,c.target_item_id,s.payload FROM ecim_candidates c JOIN ecim_sources s ON s.id=c.source_id WHERE c.id=$id AND c.report_id=$report AND c.section=$section", ("$id", candidateId), ("$report", reportId), ("$section", user.Section)).ExecuteReader();
    if (!rows.Read()) return Results.NotFound();
    var sourceId = rows.GetString(0);
    var existingTarget = NullableString(rows, 1);
    var payload = rows.GetString(2);
    rows.Close();
    var targetItemId = request.TargetItemId ?? existingTarget;
    if (request.Action == "create")
    {
        targetItemId = Guid.NewGuid().ToString();
        var source = System.Text.Json.JsonDocument.Parse(payload).RootElement;
        var title = $"eCIM {Text(source, "summary") ?? Text(source, "title") ?? "工作"}";
        Store.Sql(db, "INSERT INTO items(id,report_id,continuity_id,section,owner_section,title,content,details,status,version,created_by) VALUES($id,$report,$continuity,'appendix',$owner,$title,$content,'{}','open',1,$actor)",
            ("$id", targetItemId), ("$report", reportId), ("$continuity", Guid.NewGuid().ToString()), ("$owner", user.Section), ("$title", title[..Math.Min(title.Length, 200)]), ("$content", payload), ("$actor", user.EmpNo)).ExecuteNonQuery();
        UpsertFieldOrigin(db, targetItemId, null, payload, payload, false);
    }
    else if (request.Action is "merge" or "keep-manual" or "apply-source")
    {
        if (string.IsNullOrWhiteSpace(targetItemId)) return Results.BadRequest(new { error = "targetItemId required" });
        var target = GetItem(db, targetItemId);
        if (target is null || Store.Sql(db, "SELECT 1 FROM items WHERE id=$id AND report_id=$report", ("$id", targetItemId), ("$report", reportId)).ExecuteScalar() is null || !CanEdit(user, target.OwnerSection)) return Results.BadRequest(new { error = "invalid targetItemId" });
        var origin = GetFieldOrigin(db, targetItemId);
        if (request.Action is "merge" or "apply-source")
        {
            Store.Sql(db, "UPDATE items SET content=$content,version=version+1 WHERE id=$id", ("$content", payload), ("$id", targetItemId)).ExecuteNonQuery();
            Store.Sql(db, "INSERT INTO audit(item_id,actor,at,action) VALUES($id,$actor,$at,'source-applied')", ("$id", targetItemId), ("$actor", user.EmpNo), ("$at", DateTimeOffset.UtcNow.ToString("O"))).ExecuteNonQuery();
            UpsertFieldOrigin(db, targetItemId, origin?.LatestSourceValue, payload, payload, false);
        }
        else UpsertFieldOrigin(db, targetItemId, origin?.LatestSourceValue, payload, target.Content, true);
    }
    Store.Sql(db, "UPDATE ecim_candidates SET status=$status,target_item_id=$target,decided_by=$actor,decided_at=$at WHERE id=$id", ("$status", request.Action), ("$target", targetItemId), ("$actor", user.EmpNo), ("$at", DateTimeOffset.UtcNow.ToString("O")), ("$id", candidateId)).ExecuteNonQuery();
    tx.Commit();
    return Results.Ok(new { decision = request.Action, targetItemId });
});
app.MapGet("/api/items/{itemId}/field-origins", (HttpContext ctx, Store store, string itemId) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (!CanEdit(Current(ctx), item.OwnerSection)) return Results.StatusCode(403);
    using var rows = Store.Sql(db, "SELECT field_name,last_source_value,latest_source_value,report_value,human_override,edited_at FROM field_origins WHERE item_id=$item ORDER BY field_name", ("$item", itemId)).ExecuteReader();
    var origins = new List<object>();
    while (rows.Read()) origins.Add(new { fieldName = rows.GetString(0), lastSourceValue = NullableString(rows, 1), latestSourceValue = rows.GetString(2), reportValue = rows.GetString(3), humanOverride = rows.GetInt32(4) == 1, editedAt = rows.GetString(5) });
    return Results.Ok(origins);
});
app.MapGet("/api/reports/{reportId}", (HttpContext ctx, Store store, string reportId) =>
{
    var user = Current(ctx);
    if (!Editor(user)) return Results.StatusCode(403);
    using var db = store.Open();
    var date = Store.Sql(db, "SELECT meeting_date FROM reports WHERE id=$id", ("$id", reportId)).ExecuteScalar() as string;
    if (date is null) return Results.NotFound();
    using var rows = Store.Sql(db, "SELECT i.id,i.continuity_id,i.section,i.owner_section,CASE WHEN i.version=0 THEN COALESCE(d.title,i.title) ELSE i.title END,i.content,i.details,i.status,i.version,l.holder,l.expires_at FROM items i LEFT JOIN leases l ON l.item_id=i.id LEFT JOIN drafts d ON d.item_id=i.id AND d.editor=$actor WHERE i.report_id=$id AND (i.version>0 OR i.created_by=$actor OR (i.section='personnel' AND i.owner_section=$userSection)) ORDER BY i.rowid", ("$id", reportId), ("$actor", user.EmpNo), ("$userSection", user.Section)).ExecuteReader();
    var items = new List<object>();
    while (rows.Read())
    {
        var section = rows.GetString(2);
        var ownerSection = rows.GetString(3);
        if (!CanEdit(user, ownerSection)) continue;
        items.Add(new { id = rows.GetString(0), continuityId = rows.GetString(1), section, ownerSection, title = rows.GetString(4), content = rows.GetString(5), details = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(rows.GetString(6)), status = rows.GetString(7), version = rows.GetInt32(8), lease = LeaseView(rows, 9) });
    }
    return Results.Ok(new { id = reportId, meetingDate = date, sections = ReportSections.All, items });
});
app.MapPost("/api/reports/{reportId}/publications", (HttpContext ctx, Store store, IConfiguration config, string reportId, PublicationRequest request) =>
{
    if (Current(ctx).Role != "Guy") return Results.StatusCode(403);
    if (string.IsNullOrWhiteSpace(request.RequestId) || request.RequestId.Length > 200) return Results.BadRequest(new { error = "requestId required" });
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    if (Store.Sql(db, "SELECT 1 FROM reports WHERE id=$id", ("$id", reportId)).ExecuteScalar() is null) return Results.NotFound();
    using var existingRows = Store.Sql(db, "SELECT id,version,published_at,published_by FROM publications WHERE report_id=$report AND request_id=$request", ("$report", reportId), ("$request", request.RequestId)).ExecuteReader();
    if (existingRows.Read())
    {
        var existingId = existingRows.GetString(0);
        var existing = new { id = existingId, version = existingRows.GetInt32(1), publishedAt = existingRows.GetString(2), publishedBy = existingRows.GetString(3), url = $"/#/publications/{existingId}" };
        return Results.Ok(existing);
    }
    existingRows.Close();
    var snapshot = Snapshot(db, reportId, config);
    if (snapshot.Items.Any(item => !ValidPublicationDetails(item))) return Results.BadRequest(new { error = "unresolved carried decision requires a result or new due date" });
    var version = Convert.ToInt32(Store.Sql(db, "SELECT COALESCE(MAX(version),0)+1 FROM publications WHERE report_id=$report", ("$report", reportId)).ExecuteScalar());
    var id = Guid.NewGuid().ToString();
    var publishedAt = DateTimeOffset.UtcNow.ToString("O");
    Store.Sql(db, "INSERT INTO publications(id,report_id,version,request_id,published_by,published_at,snapshot) VALUES($id,$report,$version,$request,$actor,$at,$snapshot)",
        ("$id", id), ("$report", reportId), ("$version", version), ("$request", request.RequestId), ("$actor", Current(ctx).EmpNo), ("$at", publishedAt), ("$snapshot", System.Text.Json.JsonSerializer.Serialize(snapshot))).ExecuteNonQuery();
    tx.Commit();
    return Results.Created($"/api/publications/{id}", new { id, version, publishedAt, publishedBy = Current(ctx).EmpNo, url = $"/#/publications/{id}" });
});
app.MapGet("/api/publications/{publicationId}", (HttpContext ctx, Store store, string publicationId) =>
{
    if (!CanReadPublication(Current(ctx))) return Results.StatusCode(403);
    using var db = store.Open();
    using var rows = Store.Sql(db, "SELECT p.version,p.published_at,p.published_by,p.snapshot FROM publications p WHERE p.id=$id", ("$id", publicationId)).ExecuteReader();
    if (!rows.Read()) return Results.NotFound();
    var snapshot = System.Text.Json.JsonSerializer.Deserialize<ReportSnapshot>(rows.GetString(3));
    return Results.Ok(new { id = publicationId, version = rows.GetInt32(0), publishedAt = rows.GetString(1), publishedBy = rows.GetString(2), meetingDate = snapshot!.MeetingDate, sections = ReportSections.All, items = snapshot.Items, sourceStatus = snapshot.SourceStatus });
});
app.MapGet("/api/publications/{publicationId}/items/{itemId}/schedule-entries/{entryId}/history", (HttpContext ctx, Store store, string publicationId, string itemId, string entryId) =>
{
    if (!CanReadPublication(Current(ctx))) return Results.StatusCode(403);
    using var db = store.Open();
    using var rows = Store.Sql(db, "SELECT snapshot FROM publications WHERE id=$id", ("$id", publicationId)).ExecuteReader();
    if (!rows.Read()) return Results.NotFound();
    var snapshot = System.Text.Json.JsonSerializer.Deserialize<ReportSnapshot>(rows.GetString(0));
    var item = snapshot?.Items.FirstOrDefault(i => i.Id == itemId);
    if (item is null) return Results.NotFound();
    var entry = item.Schedule?.FirstOrDefault(e => e.Id == entryId);
    if (entry is null) return Results.NotFound();
    return Results.Ok(entry.History ?? []);
});
app.MapGet("/api/publications/{publicationId}/items/{itemId}/schedule-entries/{entryId}/evidence", (HttpContext ctx, Store store, string publicationId, string itemId, string entryId) =>
{
    if (!CanReadPublication(Current(ctx))) return Results.StatusCode(403);
    using var db = store.Open();
    using var rows = Store.Sql(db, "SELECT snapshot FROM publications WHERE id=$id", ("$id", publicationId)).ExecuteReader();
    if (!rows.Read()) return Results.NotFound();
    var snapshot = System.Text.Json.JsonSerializer.Deserialize<ReportSnapshot>(rows.GetString(0));
    var item = snapshot?.Items.FirstOrDefault(i => i.Id == itemId);
    if (item is null) return Results.NotFound();
    var entry = item.Schedule?.FirstOrDefault(e => e.Id == entryId);
    if (entry is null) return Results.NotFound();
    return Results.Ok(entry.EvidenceLinks ?? []);
});
app.MapGet("/api/publications/{publicationId}/items/{itemId}/external-dependencies/{depId}/history", (HttpContext ctx, Store store, string publicationId, string itemId, string depId) =>
{
    if (!CanReadPublication(Current(ctx))) return Results.StatusCode(403);
    using var db = store.Open();
    using var rows = Store.Sql(db, "SELECT snapshot FROM publications WHERE id=$id", ("$id", publicationId)).ExecuteReader();
    if (!rows.Read()) return Results.NotFound();
    var snapshot = System.Text.Json.JsonSerializer.Deserialize<ReportSnapshot>(rows.GetString(0));
    var item = snapshot?.Items.FirstOrDefault(i => i.Id == itemId);
    if (item is null) return Results.NotFound();
    var dep = item.ExternalDependencies?.FirstOrDefault(d => d.Id == depId);
    if (dep is null) return Results.NotFound();
    return Results.Ok(dep.History ?? []);
});
app.MapGet("/api/publications/latest", (HttpContext ctx, Store store) =>
{
    if (!CanReadPublication(Current(ctx))) return Results.StatusCode(403);
    using var db = store.Open();
    var id = Store.Sql(db, "SELECT id FROM publications ORDER BY published_at DESC LIMIT 1").ExecuteScalar() as string;
    return id is null ? Results.NotFound() : Results.Ok(new { id });
});
app.MapPost("/api/reports/{reportId}/items", (HttpContext ctx, Store store, string reportId, CreateItem request) =>
{
    var user = Current(ctx);
    var ownerSection = user.Role == "Guy" ? request.OwnerSection ?? "cross" : user.Section;
    if (!Editor(user) || user.Role == "Head" && request.OwnerSection is not null && request.OwnerSection != user.Section) return Results.StatusCode(403);
    if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Length > 200 || !ReportSections.All.Contains(request.Section)) return Results.BadRequest();
    if (string.IsNullOrWhiteSpace(ownerSection)) return Results.BadRequest();
    using var db = store.Open();
    if (request.Section == "personnel" && !ValidSection(db, ownerSection)) return Results.BadRequest(new { error = "personnel items require a relevant section" });
    using var tx = db.BeginTransaction();
    if (Store.Sql(db, "SELECT 1 FROM reports WHERE id=$id", ("$id", reportId)).ExecuteScalar() is null) return Results.NotFound();
    var id = Guid.NewGuid().ToString();
    Store.Sql(db, "INSERT INTO items(id,report_id,continuity_id,section,owner_section,title,created_by) VALUES($id,$report,$continuity,$section,$owner,$title,$actor)",
        ("$id", id), ("$report", reportId), ("$continuity", Guid.NewGuid().ToString()), ("$section", request.Section), ("$owner", ownerSection), ("$title", request.Title.Trim()), ("$actor", user.EmpNo)).ExecuteNonQuery();
    Store.Sql(db, "INSERT INTO drafts(item_id,editor,title,content,status,saved_at) VALUES($id,$actor,$title,'','open',$at)",
        ("$id", id), ("$actor", user.EmpNo), ("$title", request.Title.Trim()), ("$at", DateTimeOffset.UtcNow.ToString("O"))).ExecuteNonQuery();
    tx.Commit();
    return Results.Created($"/api/items/{id}", new { id, version = 0 });
});
app.MapPost("/api/items/{itemId}/project-participants", (HttpContext ctx, Store store, string itemId, ProjectParticipantRequest request) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var participantSection = request.Section?.Trim();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item) || !ValidSection(db, participantSection)) return Results.StatusCode(403);
    Store.Sql(db, "INSERT INTO project_participants(project_id,section) VALUES($project,$section) ON CONFLICT(project_id,section) DO NOTHING", ("$project", itemId), ("$section", participantSection)).ExecuteNonQuery();
    return Results.NoContent();
});
app.MapGet("/api/items/{itemId}/project-work", (HttpContext ctx, Store store, string itemId) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (item.Section != "projects") return Results.BadRequest();
    var maintains = CanMaintainProject(user, item);
    if (!maintains && !IsProjectParticipant(db, itemId, user.Section)) return Results.StatusCode(403);
    using var rows = Store.Sql(db, maintains
        ? "SELECT section,work,schedule_proposal,version,updated_by,updated_at FROM project_work WHERE project_id=$project ORDER BY section"
        : "SELECT section,work,schedule_proposal,version,updated_by,updated_at FROM project_work WHERE project_id=$project AND section=$section",
        ("$project", itemId), ("$section", user.Section)).ExecuteReader();
    var work = new List<object>();
    while (rows.Read()) work.Add(new { section = rows.GetString(0), work = rows.GetString(1), scheduleProposal = rows.IsDBNull(2) ? null : rows.GetString(2), version = rows.GetInt32(3), updatedBy = rows.GetString(4), updatedAt = rows.GetString(5) });
    return Results.Ok(work);
});
app.MapPut("/api/items/{itemId}/project-work", (HttpContext ctx, Store store, string itemId, ProjectWorkRequest request) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    var work = request.Work?.Trim();
    if (item.Section != "projects" || !ValidProjectWork(work, request.ScheduleProposal)) return Results.BadRequest();
    var section = CanMaintainProject(user, item) ? request.Section?.Trim() : user.Section;
    if (string.IsNullOrWhiteSpace(section) || !IsProjectParticipant(db, itemId, section) || !CanMaintainProject(user, item) && section != user.Section) return Results.StatusCode(403);
    var proposal = string.IsNullOrWhiteSpace(request.ScheduleProposal) ? null : request.ScheduleProposal.Trim();
    using var tx = db.BeginTransaction();
    using var currentRows = Store.Sql(db, "SELECT work,schedule_proposal,version FROM project_work WHERE project_id=$project AND section=$section", ("$project", itemId), ("$section", section)).ExecuteReader();
    var exists = currentRows.Read();
    var beforeWork = exists ? currentRows.GetString(0) : "";
    var beforeProposal = exists && !currentRows.IsDBNull(1) ? currentRows.GetString(1) : null;
    var beforeVersion = exists ? currentRows.GetInt32(2) : 0;
    currentRows.Close();
    if (request.BaseVersion != beforeVersion) return Results.Conflict(new { error = "stale project work version", latest = new { work = beforeWork, scheduleProposal = beforeProposal, version = beforeVersion } });
    var at = DateTimeOffset.UtcNow.ToString("O");
    if (exists)
        Store.Sql(db, "UPDATE project_work SET work=$work,schedule_proposal=$proposal,version=version+1,updated_by=$actor,updated_at=$at WHERE project_id=$project AND section=$section AND version=$version", ("$work", work), ("$proposal", proposal), ("$actor", user.EmpNo), ("$at", at), ("$project", itemId), ("$section", section), ("$version", beforeVersion)).ExecuteNonQuery();
    else
        Store.Sql(db, "INSERT INTO project_work(project_id,section,work,schedule_proposal,version,updated_by,updated_at) VALUES($project,$section,$work,$proposal,1,$actor,$at)", ("$project", itemId), ("$section", section), ("$work", work), ("$proposal", proposal), ("$actor", user.EmpNo), ("$at", at)).ExecuteNonQuery();
    Store.Sql(db, "INSERT INTO project_work_revisions(project_id,section,actor,at,before_version,after_version,before_work,after_work,before_schedule_proposal,after_schedule_proposal) VALUES($project,$section,$actor,$at,$before,$after,$beforeWork,$afterWork,$beforeProposal,$afterProposal)", ("$project", itemId), ("$section", section), ("$actor", user.EmpNo), ("$at", at), ("$before", beforeVersion), ("$after", beforeVersion + 1), ("$beforeWork", beforeWork), ("$afterWork", work), ("$beforeProposal", beforeProposal), ("$afterProposal", proposal)).ExecuteNonQuery();
    if (!string.IsNullOrWhiteSpace(request.ScheduleEntryId))
    {
        var targetEntry = ScheduleEntry(db, request.ScheduleEntryId);
        if (targetEntry is not null && targetEntry.ProjectId == itemId && CanSubmitProposal(db, item, targetEntry, user))
        {
            var origin = ResolveProposalSourceOrigin(user, item, targetEntry, request.SourceOrigin);
            CreateProposalRecord(db, itemId, targetEntry, user, request.ProgressPercent, work!, request.ProposedStart, request.ProposedEnd, null, null, origin, at, "submit", "經由協作路徑提交提案");
        }
    }
    tx.Commit();
    return Results.Ok(new { version = beforeVersion + 1 });
});
app.MapGet("/api/items/{itemId}/proposals", (HttpContext ctx, Store store, string itemId) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (item.Section != "projects" || !CanReadProject(db, item, user)) return Results.StatusCode(403);
    return Results.Ok(GetProjectProposals(db, itemId));
});
app.MapGet("/api/items/{itemId}/proposals/{proposalId}/history", (HttpContext ctx, Store store, string itemId, string proposalId) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (item.Section != "projects" || !CanReadProject(db, item, user)) return Results.StatusCode(403);

    using var rows = Store.Sql(db, "SELECT actor, at, action, reason, details FROM project_proposal_history WHERE proposal_id=$pid ORDER BY id DESC", ("$pid", proposalId)).ExecuteReader();
    var history = new List<object>();
    while (rows.Read())
    {
        var actor = rows.GetString(0);
        history.Add(new {
            actor,
            actorName = GetUserName(db, actor),
            at = rows.GetString(1),
            action = rows.GetString(2),
            reason = rows.IsDBNull(3) ? null : rows.GetString(3),
            details = rows.IsDBNull(4) ? null : rows.GetString(4)
        });
    }
    return Results.Ok(history);
});
app.MapPost("/api/items/{itemId}/proposals", (HttpContext ctx, Store store, string itemId, ProjectProposalRequest request) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects") return Results.BadRequest();
    var user = Current(ctx);

    if (string.IsNullOrWhiteSpace(request.ScheduleEntryId))
        return Results.BadRequest(new { error = "schedule entry required" });
    if (string.IsNullOrWhiteSpace(request.WorkDescription))
        return Results.BadRequest(new { error = "work description required" });

    var entry = ScheduleEntry(db, request.ScheduleEntryId);
    if (entry is null || entry.ProjectId != itemId) return Results.NotFound();

    if (!CanSubmitProposal(db, item, entry, user))
        return Results.StatusCode(403);

    var sourceOrigin = ResolveProposalSourceOrigin(user, item, entry, request.SourceOrigin);

    if (request.ProgressPercent is < 0 or > 100)
        return Results.BadRequest(new { error = "invalid progress percent" });

    if (request.ProposedStart is not null && !DateOnly.TryParseExact(request.ProposedStart, "yyyy-MM-dd", out _))
        return Results.BadRequest(new { error = "invalid proposed start date" });
    if (request.ProposedEnd is not null && !DateOnly.TryParseExact(request.ProposedEnd, "yyyy-MM-dd", out _))
        return Results.BadRequest(new { error = "invalid proposed end date" });
    if (request.ProposedStart is not null && request.ProposedEnd is not null && string.CompareOrdinal(request.ProposedStart, request.ProposedEnd) > 0)
        return Results.BadRequest(new { error = "proposed start date must not be after end date" });

    using var tx = db.BeginTransaction();
    var at = DateTimeOffset.UtcNow.ToString("O");
    var (proposalId, finalOrigin) = CreateProposalRecord(db, itemId, entry, user, request.ProgressPercent, request.WorkDescription.Trim(), request.ProposedStart, request.ProposedEnd, request.ProposedDate, request.ProposedState, sourceOrigin, at, "submit", "提交進度與時程提案");
    tx.Commit();

    return Results.Created($"/api/items/{itemId}/proposals/{proposalId}", new {
        id = proposalId,
        status = "pending",
        sourceOrigin = finalOrigin,
        scheduleEntryId = entry.Id
    });
});
app.MapPost("/api/items/{itemId}/proposals/{proposalId}/accept", (HttpContext ctx, Store store, string itemId, string proposalId, ProposalDecisionRequest request) =>
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item)) return Results.StatusCode(403);

    if (string.IsNullOrWhiteSpace(request.Reason))
        return Results.BadRequest(new { error = "reason required" });

    var conflict = ScheduleWriteConflict(db, item, Current(ctx), new ScheduleRequest(null, null, null, null, null, null, null, null, null, null, null, null, null, request.Token, request.BaseProjectVersion, null, null, null));
    if (conflict is not null) return conflict;

    using var pRows = Store.Sql(db, """
        SELECT id, schedule_entry_id, progress_percent, work_description, proposed_start, proposed_end, proposed_date, proposed_state, source_origin, status
        FROM project_proposals WHERE id=$id AND project_id=$proj
        """, ("$id", proposalId), ("$proj", itemId)).ExecuteReader();

    if (!pRows.Read()) return Results.NotFound();
    var entryId = pRows.GetString(1);
    var progressPercent = pRows.IsDBNull(2) ? (int?)null : pRows.GetInt32(2);
    var workDesc = pRows.GetString(3);
    var propStart = pRows.IsDBNull(4) ? null : pRows.GetString(4);
    var propEnd = pRows.IsDBNull(5) ? null : pRows.GetString(5);
    var propDate = pRows.IsDBNull(6) ? null : pRows.GetString(6);
    var propState = pRows.IsDBNull(7) ? null : pRows.GetString(7);
    var sourceOrigin = pRows.IsDBNull(8) ? null : pRows.GetString(8);
    var status = pRows.GetString(9);
    pRows.Close();

    if (status != "pending")
        return Results.BadRequest(new { error = "proposal already decided" });

    var entry = ScheduleEntry(db, entryId);
    if (entry is null) return Results.NotFound();

    if (request.BaseEntryVersion.HasValue && request.BaseEntryVersion.Value != entry.Version)
        return Results.Conflict(new { error = "stale schedule entry version", latest = entry });

    var at = DateTimeOffset.UtcNow.ToString("O");
    var user = Current(ctx);
    var reason = request.Reason.Trim();

    var newForecastStart = propStart ?? entry.ForecastStart;
    var newForecastEnd = propEnd ?? entry.ForecastEnd;
    var newForecastDate = propDate ?? entry.ForecastDate;
    var newState = propState ?? entry.State;

    if (entry.Kind != "milestone" && newForecastStart is not null && newForecastEnd is not null)
    {
        if (!ValidDateRange(newForecastStart, newForecastEnd))
            return Results.BadRequest(new { error = "invalid date range in proposal" });
    }

    if (newState != entry.State)
    {
        var proposedScheduleRequest = new ScheduleRequest(
            entry.Kind, entry.Name, entry.BaselineStart, entry.BaselineEnd,
            newForecastStart, newForecastEnd, entry.ActualStart, entry.ActualEnd,
            null, entry.Version, newState, reason, null, request.Token, request.BaseProjectVersion,
            entry.Owner, entry.PhaseId, false, entry.BaselineDate, entry.BaselineDate, newForecastDate, entry.ActualDate
        );
        if (!ValidScheduleRange(proposedScheduleRequest))
            return Results.BadRequest(new { error = $"cannot transition task state to '{newState}' without meeting actual date constraints" });
    }

    Store.Sql(db, "UPDATE project_proposals SET status='accepted', decided_by=$decided_by, decided_at=$decided_at, decision_reason=$reason WHERE id=$id",
        ("$decided_by", user.EmpNo), ("$decided_at", at), ("$reason", reason), ("$id", proposalId)).ExecuteNonQuery();

    Store.Sql(db, "INSERT INTO project_proposal_history(proposal_id, actor, at, action, reason, details) VALUES($pid, $actor, $at, 'accept', $reason, $details)",
        ("$pid", proposalId), ("$actor", user.EmpNo), ("$at", at), ("$reason", reason), ("$details", $"採納時程提案（來源：{sourceOrigin}）")).ExecuteNonQuery();

    Store.Sql(db, """
        UPDATE project_schedule_entries
        SET forecast_start=$fstart, forecast_end=$fend, forecast_date=$fdate, state=$state, version=version+1, updated_at=$at
        WHERE id=$id
        """,
        ("$fstart", newForecastStart), ("$fend", newForecastEnd), ("$fdate", newForecastDate),
        ("$state", newState), ("$at", at), ("$id", entryId)).ExecuteNonQuery();

    var afterEntry = entry with {
        ForecastStart = newForecastStart,
        ForecastEnd = newForecastEnd,
        ForecastDate = newForecastDate,
        State = newState,
        Version = entry.Version + 1
    };

    SaveScheduleRevision(db, entryId, user.EmpNo, at, "accept-proposal", $"採納時程提案（{sourceOrigin}）：{reason}", entry, afterEntry);
    NotifySuccessorsOfPredecessorChange(db, itemId, entryId, user.EmpNo, at, reason);

    Store.Sql(db, "INSERT INTO audit(item_id, actor, at, action, reason) VALUES($id, $actor, $at, 'accept-proposal', $reason)",
        ("$id", itemId), ("$actor", user.EmpNo), ("$at", at), ("$reason", $"採納任務「{entry.Name}」提案：{reason}")).ExecuteNonQuery();

    AdvanceProjectVersion(db, item);
    tx.Commit();
    return Results.Ok(new { projectVersion = item.Version + 1, entryVersion = entry.Version + 1 });
});
app.MapPost("/api/items/{itemId}/proposals/{proposalId}/reject", (HttpContext ctx, Store store, string itemId, string proposalId, ProposalDecisionRequest request) =>
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item)) return Results.StatusCode(403);

    if (string.IsNullOrWhiteSpace(request.Reason))
        return Results.BadRequest(new { error = "reason required" });

    using var pRows = Store.Sql(db, "SELECT status FROM project_proposals WHERE id=$id AND project_id=$proj", ("$id", proposalId), ("$proj", itemId)).ExecuteReader();
    if (!pRows.Read()) return Results.NotFound();
    var status = pRows.GetString(0);
    pRows.Close();

    if (status != "pending")
        return Results.BadRequest(new { error = "proposal already decided" });

    var user = Current(ctx);
    var at = DateTimeOffset.UtcNow.ToString("O");
    var reason = request.Reason.Trim();

    Store.Sql(db, "UPDATE project_proposals SET status='rejected', decided_by=$decided_by, decided_at=$decided_at, decision_reason=$reason WHERE id=$id",
        ("$decided_by", user.EmpNo), ("$decided_at", at), ("$reason", reason), ("$id", proposalId)).ExecuteNonQuery();

    Store.Sql(db, "INSERT INTO project_proposal_history(proposal_id, actor, at, action, reason, details) VALUES($pid, $actor, $at, 'reject', $reason, $details)",
        ("$pid", proposalId), ("$actor", user.EmpNo), ("$at", at), ("$reason", reason), ("$details", "退回/駁回時程提案")).ExecuteNonQuery();

    Store.Sql(db, "INSERT INTO audit(item_id, actor, at, action, reason) VALUES($id, $actor, $at, 'reject-proposal', $reason)",
        ("$id", itemId), ("$actor", user.EmpNo), ("$at", at), ("$reason", $"退回提案：{reason}")).ExecuteNonQuery();

    tx.Commit();
    return Results.Ok(new { id = proposalId, status = "rejected" });
});
app.MapGet("/api/items/{itemId}/schedule", (HttpContext ctx, Store store, string itemId) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (item.Section != "projects" || !CanReadProject(db, item, user)) return Results.StatusCode(403);
    return Results.Ok(ScheduleEntries(db, itemId));
});
app.MapPost("/api/items/{itemId}/schedule", (HttpContext ctx, Store store, string itemId, ScheduleRequest request) =>
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item)) return Results.StatusCode(403);
    if (item.Version == 0) return Results.BadRequest(new { error = "commit the project item before creating schedule entries" });
    if (request.Kind == "milestone")
    {
        var targetDate = request.TargetDate ?? (request.BaselineDate == request.ForecastDate ? request.BaselineDate : null);
        if (string.IsNullOrWhiteSpace(request.Name) || request.Name.Length > 200 ||
            targetDate is null || !DateOnly.TryParseExact(targetDate, "yyyy-MM-dd", out _) ||
            request.State != "pending" || request.ActualDate is not null ||
            request.Owner is not null || request.PhaseId is not null ||
            request.BaselineStart is not null || request.BaselineEnd is not null ||
            request.ForecastStart is not null || request.ForecastEnd is not null ||
            request.ActualStart is not null || request.ActualEnd is not null)
            return Results.BadRequest(new { error = "invalid milestone" });

        var conflict = ScheduleWriteConflict(db, item, Current(ctx), request);
        if (conflict is not null) return conflict;
        var id = Guid.NewGuid().ToString();
        var at = DateTimeOffset.UtcNow.ToString("O");
        Store.Sql(db, "INSERT INTO project_schedule_entries(id,continuity_id,project_id,kind,name,baseline_date,forecast_date,actual_date,state,created_by,updated_at) VALUES($id,$continuity,$project,'milestone',$name,$targetDate,$targetDate,NULL,'pending',$actor,$at)",
            ("$id", id), ("$continuity", id), ("$project", itemId), ("$name", request.Name.Trim()), ("$targetDate", targetDate), ("$actor", Current(ctx).EmpNo), ("$at", at)).ExecuteNonQuery();
        var created = ScheduleEntry(db, id)!;
        SaveScheduleRevision(db, id, Current(ctx).EmpNo, at, "create", null, null, created);
        AdvanceProjectVersion(db, item);
        tx.Commit();
        return Results.Created($"/api/items/{itemId}/schedule/{id}", new { id, version = 1, projectVersion = item.Version + 1 });
    }
    if (request.Kind is not ("phase" or "task") || !ValidScheduleRange(request) || !ValidTaskFields(db, itemId, request, null) || request.State != "open" || request.ForecastStart != request.BaselineStart || request.ForecastEnd != request.BaselineEnd) return Results.BadRequest(new { error = "invalid phase or task" });
    var conflictPhaseTask = ScheduleWriteConflict(db, item, Current(ctx), request);
    if (conflictPhaseTask is not null) return conflictPhaseTask;
    var phaseTaskId = Guid.NewGuid().ToString();
    var phaseTaskAt = DateTimeOffset.UtcNow.ToString("O");
    Store.Sql(db, "INSERT INTO project_schedule_entries(id,continuity_id,project_id,kind,name,baseline_start,baseline_end,forecast_start,forecast_end,actual_start,actual_end,state,owner,phase_id,created_by,updated_at) VALUES($id,$continuity,$project,$kind,$name,$baselineStart,$baselineEnd,$forecastStart,$forecastEnd,$actualStart,$actualEnd,$state,$owner,$phase,$actor,$at)",
        ("$id", phaseTaskId), ("$continuity", phaseTaskId), ("$project", itemId), ("$kind", request.Kind), ("$name", request.Name!.Trim()), ("$baselineStart", request.BaselineStart), ("$baselineEnd", request.BaselineEnd), ("$forecastStart", request.ForecastStart), ("$forecastEnd", request.ForecastEnd), ("$actualStart", request.ActualStart), ("$actualEnd", request.ActualEnd), ("$state", request.State), ("$owner", request.Kind == "task" ? request.Owner!.Trim() : null), ("$phase", request.PhaseId), ("$actor", Current(ctx).EmpNo), ("$at", phaseTaskAt)).ExecuteNonQuery();
    var createdPhaseTask = ScheduleEntry(db, phaseTaskId)!;
    SaveScheduleRevision(db, phaseTaskId, Current(ctx).EmpNo, phaseTaskAt, "create", null, null, createdPhaseTask);
    AdvanceProjectVersion(db, item);
    tx.Commit();
    return Results.Created($"/api/items/{itemId}/schedule/{phaseTaskId}", new { id = phaseTaskId, version = 1, projectVersion = item.Version + 1 });
});
app.MapPut("/api/items/{itemId}/schedule/{entryId}", (HttpContext ctx, Store store, string itemId, string entryId, ScheduleRequest request) =>
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item)) return Results.StatusCode(403);
    var current = ScheduleEntry(db, entryId);
    if (current is null || current.ProjectId != itemId) return Results.NotFound();
    if (current.Kind != request.Kind) return Results.BadRequest(new { error = "kind mismatch" });
    if (request.Kind == "milestone")
    {
        var validMilestone =
            !string.IsNullOrWhiteSpace(request.Name) && request.Name.Length <= 200 &&
            request.Owner is null && request.PhaseId is null &&
            request.BaselineStart is null && request.BaselineEnd is null &&
            request.ForecastStart is null && request.ForecastEnd is null &&
            request.ActualStart is null && request.ActualEnd is null &&
            request.BaselineDate is not null && DateOnly.TryParseExact(request.BaselineDate, "yyyy-MM-dd", out _) &&
            request.ForecastDate is not null && DateOnly.TryParseExact(request.ForecastDate, "yyyy-MM-dd", out _) &&
            (request.ActualDate is null || DateOnly.TryParseExact(request.ActualDate, "yyyy-MM-dd", out _)) &&
            request.State switch
            {
                "pending" => request.ActualDate is null,
                "achieved" => request.ActualDate is not null,
                "cancelled" => request.ActualDate is null,
                _ => false
            };
        if (!validMilestone) return Results.BadRequest(new { error = "invalid milestone" });

        var conflict = ScheduleWriteConflict(db, item, Current(ctx), request);
        if (conflict is not null) return conflict;
        if (request.BaseVersion != current.Version) return ScheduleConflict(db, itemId, item.Version, "stale schedule version");
        if (string.IsNullOrWhiteSpace(request.Reason)) return Results.BadRequest(new { error = "reason required" });

        var correction = request.Action == "correct-original";
        if (request.Action is not (null or "update" or "correct-original" or "reopen" or "cancel" or "reactivate")) return Results.BadRequest(new { error = "invalid action" });

        var originalChanged = current.BaselineDate != request.BaselineDate;
        if (originalChanged != correction) return Results.BadRequest(new { error = "original plan changes require correct-original action" });

        if (request.Action == "reopen" && (current.State != "achieved" || request.State != "pending" || request.ActualDate is not null)) return Results.BadRequest(new { error = "invalid reopen" });
        if (request.Action == "cancel" && (current.State == "cancelled" || request.State != "cancelled")) return Results.BadRequest(new { error = "invalid cancel" });
        if (request.Action == "reactivate" && (current.State != "cancelled" || request.State != "pending")) return Results.BadRequest(new { error = "invalid reactivate" });
        if (request.Action is not ("reopen" or "cancel") && current.State == "achieved" && request.State != "achieved") return Results.BadRequest(new { error = "reopen action required" });
        if (request.State == "cancelled" && current.State != "cancelled" && request.Action != "cancel") return Results.BadRequest(new { error = "cancel action required" });
        if (current.State == "cancelled" && request.State != "cancelled" && request.Action != "reactivate") return Results.BadRequest(new { error = "reactivate action required" });

        var at = DateTimeOffset.UtcNow.ToString("O");
        if (request.Action == "cancel")
        {
            var hasActiveSuccessors = Store.Sql(db, "SELECT 1 FROM project_schedule_dependencies WHERE predecessor_id=$id", ("$id", entryId)).ExecuteScalar() is not null;
            if (hasActiveSuccessors)
                return Results.BadRequest(new { error = "cannot cancel item with active successors; remove or replace successor dependency links first" });

            var incomingPredIds = new List<string>();
            using (var predRows = Store.Sql(db, "SELECT predecessor_id FROM project_schedule_dependencies WHERE successor_id=$id", ("$id", entryId)).ExecuteReader())
            {
                while (predRows.Read()) incomingPredIds.Add(predRows.GetString(0));
            }
            if (incomingPredIds.Count > 0)
            {
                Store.Sql(db, "DELETE FROM project_schedule_dependencies WHERE successor_id=$id", ("$id", entryId)).ExecuteNonQuery();
                foreach (var pId in incomingPredIds)
                {
                    var predEntry = ScheduleEntry(db, pId);
                    if (predEntry is not null)
                    {
                        SaveScheduleRevision(db, pId, Current(ctx).EmpNo, at, "unlink-dependency", $"後續項目「{current.Name}」已取消，解除相依關係", predEntry, predEntry);
                        SaveScheduleRevision(db, entryId, Current(ctx).EmpNo, at, "unlink-dependency", $"項目取消，自動解除前置項目「{predEntry.Name}」相依關係", current, current);
                    }
                }
            }

            using (var extRows = Store.Sql(db, "SELECT l.external_dependency_id, d.description FROM project_external_dependency_links l JOIN project_external_dependencies d ON d.id=l.external_dependency_id WHERE l.schedule_entry_id=$id", ("$id", entryId)).ExecuteReader())
            {
                var extToClean = new List<(string DepId, string Desc)>();
                while (extRows.Read()) extToClean.Add((extRows.GetString(0), extRows.GetString(1)));
                extRows.Close();
                if (extToClean.Count > 0)
                {
                    Store.Sql(db, "DELETE FROM project_external_dependency_links WHERE schedule_entry_id=$id", ("$id", entryId)).ExecuteNonQuery();
                    foreach (var (dId, dDesc) in extToClean)
                    {
                        SaveScheduleRevision(db, entryId, Current(ctx).EmpNo, at, "unlink-external-dependency", $"項目取消，自動解除跨部門相依事項「{dDesc}」關聯", current, current);
                        Store.Sql(db, "INSERT INTO project_external_dependency_history(external_dependency_id,actor,at,action,reason,schedule_entry_id,schedule_entry_name) VALUES($dep,$actor,$at,'unlink','項目取消自動解除關聯',$entry,$name)",
                            ("$dep", dId), ("$actor", Current(ctx).EmpNo), ("$at", at), ("$entry", entryId), ("$name", current.Name)).ExecuteNonQuery();
                    }
                }
            }
        }

        Store.Sql(db, "UPDATE project_schedule_entries SET name=$name,baseline_date=$baselineDate,forecast_date=$forecastDate,actual_date=$actualDate,state=$state,version=version+1,updated_at=$at WHERE id=$id AND version=$version",
            ("$name", request.Name!.Trim()), ("$baselineDate", request.BaselineDate), ("$forecastDate", request.ForecastDate), ("$actualDate", request.ActualDate), ("$state", request.State), ("$at", at), ("$id", entryId), ("$version", current.Version)).ExecuteNonQuery();
        SaveScheduleRevision(db, entryId, Current(ctx).EmpNo, at, request.Action ?? "update", request.Reason!.Trim(), current, ScheduleEntry(db, entryId)!);
        NotifySuccessorsOfPredecessorChange(db, itemId, entryId, Current(ctx).EmpNo, at, request.Reason!.Trim());
        AdvanceProjectVersion(db, item);
        tx.Commit();
        return Results.Ok(new { version = current.Version + 1, projectVersion = item.Version + 1 });
    }
    if (current.Kind != request.Kind || !ValidScheduleRange(request) || !ValidTaskFields(db, itemId, request, current)) return Results.BadRequest(new { error = "invalid phase or task" });
    var conflictPhaseTask = ScheduleWriteConflict(db, item, Current(ctx), request);
    if (conflictPhaseTask is not null) return conflictPhaseTask;
    if (request.BaseVersion != current.Version) return ScheduleConflict(db, itemId, item.Version, "stale schedule version");
    if (string.IsNullOrWhiteSpace(request.Reason)) return Results.BadRequest(new { error = "reason required" });
    var correctionPhaseTask = request.Action == "correct-original";
    if (request.Action is not (null or "update" or "correct-original" or "reopen" or "cancel" or "reactivate")) return Results.BadRequest(new { error = "invalid action" });
    var originalChangedPhaseTask = current.BaselineStart != request.BaselineStart || current.BaselineEnd != request.BaselineEnd;
    if (originalChangedPhaseTask != correctionPhaseTask) return Results.BadRequest(new { error = "original plan changes require correct-original action" });
    if (request.Action == "reopen" && (current.State != "completed" || request.State != "in-progress" || request.ActualEnd is not null || request.ActualStart != current.ActualStart)) return Results.BadRequest(new { error = "invalid reopen" });
    if (request.Action == "cancel" && (current.State == "cancelled" || request.State != "cancelled")) return Results.BadRequest(new { error = "invalid cancel" });
    var expectedReactivateState = current.ActualStart is not null ? "in-progress" : "open";
    if (request.Action == "reactivate" && (current.State != "cancelled" || request.State != expectedReactivateState || request.ActualStart != current.ActualStart)) return Results.BadRequest(new { error = $"invalid reactivate state or actualStart; item with actualStart {(current.ActualStart is not null ? "must return to in-progress" : "must return to open")}" });
    if (request.Action is not ("reopen" or "cancel") && current.State == "completed" && request.State != "completed") return Results.BadRequest(new { error = "reopen action required" });
    if (request.State == "cancelled" && current.State != "cancelled" && request.Action != "cancel") return Results.BadRequest(new { error = "cancel action required" });
    if (current.State == "cancelled" && request.State != "cancelled" && request.Action != "reactivate") return Results.BadRequest(new { error = "reactivate action required" });
    if (current.Kind == "phase" && request.State == "completed" && current.State != "completed")
    {
        var unfinished = ScheduleEntries(db, itemId).First(entry => entry.Id == entryId).UnfinishedTasks ?? [];
        if (unfinished.Count > 0 && request.AcknowledgeIncompleteTasks != true)
            return Results.BadRequest(new { error = "unfinished tasks require explicit confirmation and reason", unfinishedTasks = unfinished });
    }
    var atPhaseTask = DateTimeOffset.UtcNow.ToString("O");
    if (request.Action == "cancel")
    {
        var hasActiveSuccessors = Store.Sql(db, "SELECT 1 FROM project_schedule_dependencies WHERE predecessor_id=$id", ("$id", entryId)).ExecuteScalar() is not null;
        if (hasActiveSuccessors)
            return Results.BadRequest(new { error = "cannot cancel item with active successors; remove or replace successor dependency links first" });

        if (current.Kind == "phase")
        {
            var hasActiveChildTasks = Store.Sql(db, "SELECT 1 FROM project_schedule_entries WHERE project_id=$project AND phase_id=$phase AND state != 'cancelled'", ("$project", itemId), ("$phase", entryId)).ExecuteScalar() is not null;
            if (hasActiveChildTasks)
                return Results.BadRequest(new { error = "cannot cancel phase with active child tasks; reassign, move to project, or cancel child tasks first" });

            Store.Sql(db, "UPDATE project_schedule_entries SET phase_id=NULL WHERE phase_id=$id", ("$id", entryId)).ExecuteNonQuery();
        }

        var incomingPredIds = new List<string>();
        using (var predRows = Store.Sql(db, "SELECT predecessor_id FROM project_schedule_dependencies WHERE successor_id=$id", ("$id", entryId)).ExecuteReader())
        {
            while (predRows.Read()) incomingPredIds.Add(predRows.GetString(0));
        }
        if (incomingPredIds.Count > 0)
        {
            Store.Sql(db, "DELETE FROM project_schedule_dependencies WHERE successor_id=$id", ("$id", entryId)).ExecuteNonQuery();
            foreach (var pId in incomingPredIds)
            {
                var predEntry = ScheduleEntry(db, pId);
                if (predEntry is not null)
                {
                    SaveScheduleRevision(db, pId, Current(ctx).EmpNo, atPhaseTask, "unlink-dependency", $"後續項目「{current.Name}」已取消，解除相依關係", predEntry, predEntry);
                    SaveScheduleRevision(db, entryId, Current(ctx).EmpNo, atPhaseTask, "unlink-dependency", $"項目取消，自動解除前置項目「{predEntry.Name}」相依關係", current, current);
                }
            }
        }

        using (var extRows = Store.Sql(db, "SELECT l.external_dependency_id, d.description FROM project_external_dependency_links l JOIN project_external_dependencies d ON d.id=l.external_dependency_id WHERE l.schedule_entry_id=$id", ("$id", entryId)).ExecuteReader())
        {
            var extToClean = new List<(string DepId, string Desc)>();
            while (extRows.Read()) extToClean.Add((extRows.GetString(0), extRows.GetString(1)));
            extRows.Close();
            if (extToClean.Count > 0)
            {
                Store.Sql(db, "DELETE FROM project_external_dependency_links WHERE schedule_entry_id=$id", ("$id", entryId)).ExecuteNonQuery();
                foreach (var (dId, dDesc) in extToClean)
                {
                    SaveScheduleRevision(db, entryId, Current(ctx).EmpNo, atPhaseTask, "unlink-external-dependency", $"項目取消，自動解除跨部門相依事項「{dDesc}」關聯", current, current);
                    Store.Sql(db, "INSERT INTO project_external_dependency_history(external_dependency_id,actor,at,action,reason,schedule_entry_id,schedule_entry_name) VALUES($dep,$actor,$atPhaseTask,'unlink','項目取消自動解除關聯',$entry,$name)",
                        ("$dep", dId), ("$actor", Current(ctx).EmpNo), ("$atPhaseTask", atPhaseTask), ("$entry", entryId), ("$name", current.Name)).ExecuteNonQuery();
                }
            }
        }
    }

    var effectivePhaseId = (request.State == "cancelled" || current.State == "cancelled" || request.Action is "cancel" or "reactivate") ? null : request.PhaseId;
    Store.Sql(db, "UPDATE project_schedule_entries SET name=$name,baseline_start=$baselineStart,baseline_end=$baselineEnd,forecast_start=$forecastStart,forecast_end=$forecastEnd,actual_start=$actualStart,actual_end=$actualEnd,state=$state,owner=$owner,phase_id=$phase,version=version+1,updated_at=$at WHERE id=$id AND version=$version",
        ("$name", request.Name!.Trim()), ("$baselineStart", request.BaselineStart), ("$baselineEnd", request.BaselineEnd), ("$forecastStart", request.ForecastStart), ("$forecastEnd", request.ForecastEnd), ("$actualStart", request.ActualStart), ("$actualEnd", request.ActualEnd), ("$state", request.State), ("$owner", request.Kind == "task" ? request.Owner!.Trim() : null), ("$phase", effectivePhaseId), ("$at", atPhaseTask), ("$id", entryId), ("$version", current.Version)).ExecuteNonQuery();
    SaveScheduleRevision(db, entryId, Current(ctx).EmpNo, atPhaseTask, request.Action ?? "update", request.Reason!.Trim(), current, ScheduleEntry(db, entryId)!);
    NotifySuccessorsOfPredecessorChange(db, itemId, entryId, Current(ctx).EmpNo, atPhaseTask, request.Reason!.Trim());
    AdvanceProjectVersion(db, item);
    tx.Commit();
    return Results.Ok(new { version = current.Version + 1, projectVersion = item.Version + 1 });
});
app.MapDelete("/api/items/{itemId}/schedule/{entryId}", () => Results.BadRequest(new { error = "committed schedule items cannot be deleted; use cancellation" }));
app.MapPost("/api/items/{itemId}/schedule/dependencies", (HttpContext ctx, Store store, string itemId, ScheduleDependencyRequest request) =>
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item)) return Results.StatusCode(403);
    if (item.Version == 0) return Results.BadRequest(new { error = "commit the project item before linking dependencies" });
    var conflict = ScheduleWriteConflict(db, item, Current(ctx), new ScheduleRequest(null, null, null, null, null, null, null, null, null, null, null, null, null, request.Token, request.BaseProjectVersion, null, null, null));
    if (conflict is not null) return conflict;

    if (string.IsNullOrWhiteSpace(request.PredecessorId) || string.IsNullOrWhiteSpace(request.SuccessorId))
        return Results.BadRequest(new { error = "predecessor and successor required" });
    if (string.IsNullOrWhiteSpace(request.Reason))
        return Results.BadRequest(new { error = "reason required" });

    if (request.PredecessorId == request.SuccessorId)
        return Results.BadRequest(new { error = "self dependency not allowed" });

    var pred = ScheduleEntry(db, request.PredecessorId);
    var succ = ScheduleEntry(db, request.SuccessorId);
    if (pred is null || succ is null || pred.ProjectId != itemId || succ.ProjectId != itemId)
        return Results.BadRequest(new { error = "cross project or non-existent dependency" });

    if (pred.State == "cancelled" || succ.State == "cancelled")
        return Results.BadRequest(new { error = "cannot link cancelled schedule entry" });

    if ((pred.Kind == "phase" && succ.Kind == "task" && succ.PhaseId == pred.Id) ||
        (succ.Kind == "phase" && pred.Kind == "task" && pred.PhaseId == succ.Id))
    {
        return Results.BadRequest(new { error = "phase and direct subtask cannot be linked" });
    }

    if (HasDependencyCycle(db, itemId, request.PredecessorId, request.SuccessorId))
    {
        return Results.BadRequest(new { error = "dependency cycle detected" });
    }

    var exists = Store.Sql(db, "SELECT 1 FROM project_schedule_dependencies WHERE predecessor_id=$p AND successor_id=$s", ("$p", request.PredecessorId), ("$s", request.SuccessorId)).ExecuteScalar() is not null;
    if (exists) return Results.BadRequest(new { error = "dependency already exists" });

    var depId = Guid.NewGuid().ToString();
    var at = DateTimeOffset.UtcNow.ToString("O");
    var actor = Current(ctx).EmpNo;
    var reason = request.Reason.Trim();

    Store.Sql(db, "INSERT INTO project_schedule_dependencies(id,project_id,predecessor_id,successor_id,created_by,created_at,reason) VALUES($id,$project,$p,$s,$actor,$at,$reason)",
        ("$id", depId), ("$project", itemId), ("$p", request.PredecessorId), ("$s", request.SuccessorId), ("$actor", actor), ("$at", at), ("$reason", reason)).ExecuteNonQuery();

    SaveScheduleRevision(db, request.PredecessorId, actor, at, "link-dependency", $"關聯後續項目「{succ.Name}」：{reason}", pred, pred);
    SaveScheduleRevision(db, request.SuccessorId, actor, at, "link-dependency", $"建立前置項目「{pred.Name}」：{reason}", succ, succ);

    AdvanceProjectVersion(db, item);
    tx.Commit();
    return Results.Created($"/api/items/{itemId}/schedule/dependencies/{depId}", new { id = depId, projectVersion = item.Version + 1 });
});
app.MapPost("/api/items/{itemId}/schedule/dependencies/delete", (HttpContext ctx, Store store, string itemId, ScheduleDependencyRequest request) =>
{
    return RemoveDependency(ctx, store, itemId, request.PredecessorId, request.SuccessorId, request.Reason, request.Token, request.BaseProjectVersion);
});
app.MapDelete("/api/items/{itemId}/schedule/dependencies/{predecessorId}/{successorId}", (HttpContext ctx, Store store, string itemId, string predecessorId, string successorId, [Microsoft.AspNetCore.Mvc.FromQuery] string? reason, [Microsoft.AspNetCore.Mvc.FromQuery] string? token, [Microsoft.AspNetCore.Mvc.FromQuery] int? baseProjectVersion) =>
{
    return RemoveDependency(ctx, store, itemId, predecessorId, successorId, reason, token, baseProjectVersion);
});
app.MapGet("/api/items/{itemId}/external-dependencies", (HttpContext ctx, Store store, string itemId) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (item.Section != "projects" || !CanMaintainProject(user, item) && !IsProjectParticipant(db, itemId, user.Section) && (item.Version == 0 || user.Role != "Reader")) return Results.StatusCode(403);

    return Results.Ok(GetExternalDependencies(db, itemId));
});
app.MapPost("/api/items/{itemId}/external-dependencies", (HttpContext ctx, Store store, string itemId, ExternalDependencyRequest request) =>
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item)) return Results.StatusCode(403);
    if (item.Version == 0) return Results.BadRequest(new { error = "commit the project item before managing external dependencies" });

    var conflict = ScheduleWriteConflict(db, item, Current(ctx), new ScheduleRequest(null, null, null, null, null, null, null, null, null, null, null, null, null, request.Token, request.BaseProjectVersion, null, null, null));
    if (conflict is not null) return conflict;

    if (string.IsNullOrWhiteSpace(request.Description) || request.Description.Length > 500)
        return Results.BadRequest(new { error = "invalid description" });
    if (string.IsNullOrWhiteSpace(request.Supplier) || request.Supplier.Length > 200)
        return Results.BadRequest(new { error = "invalid supplier" });
    if (string.IsNullOrWhiteSpace(request.DueDate) || !DateOnly.TryParseExact(request.DueDate, "yyyy-MM-dd", out _))
        return Results.BadRequest(new { error = "invalid due date" });

    var status = request.Status ?? "pending";
    if (status is not ("pending" or "delivered"))
        return Results.BadRequest(new { error = "invalid status" });

    var id = Guid.NewGuid().ToString();
    var at = DateTimeOffset.UtcNow.ToString("O");
    var actor = Current(ctx).EmpNo;

    Store.Sql(db, "INSERT INTO project_external_dependencies(id,project_id,description,supplier,due_date,status,created_by,created_at,updated_at) VALUES($id,$project,$desc,$supp,$due,$status,$actor,$at,$at)",
        ("$id", id), ("$project", itemId), ("$desc", request.Description.Trim()), ("$supp", request.Supplier.Trim()), ("$due", request.DueDate.Trim()), ("$status", status), ("$actor", actor), ("$at", at)).ExecuteNonQuery();

    Store.Sql(db, "INSERT INTO project_external_dependency_history(external_dependency_id,actor,at,action,reason) VALUES($dep,$actor,$at,'create',$reason)",
        ("$dep", id), ("$actor", actor), ("$at", at), ("$reason", request.Reason?.Trim() ?? "建立跨部門相依事項")).ExecuteNonQuery();

    AdvanceProjectVersion(db, item);
    tx.Commit();
    return Results.Created($"/api/items/{itemId}/external-dependencies/{id}", new { id, projectVersion = item.Version + 1 });
});
app.MapPut("/api/items/{itemId}/external-dependencies/{depId}", (HttpContext ctx, Store store, string itemId, string depId, ExternalDependencyRequest request) =>
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item)) return Results.StatusCode(403);

    var conflict = ScheduleWriteConflict(db, item, Current(ctx), new ScheduleRequest(null, null, null, null, null, null, null, null, null, null, null, null, null, request.Token, request.BaseProjectVersion, null, null, null));
    if (conflict is not null) return conflict;

    using var depRow = Store.Sql(db, "SELECT description,supplier,due_date,status FROM project_external_dependencies WHERE id=$id AND project_id=$project", ("$id", depId), ("$project", itemId)).ExecuteReader();
    if (!depRow.Read()) return Results.NotFound();
    var oldDesc = depRow.GetString(0);
    var oldSupp = depRow.GetString(1);
    var oldDue = depRow.GetString(2);
    var oldStatus = depRow.GetString(3);
    depRow.Close();

    if (string.IsNullOrWhiteSpace(request.Description) || request.Description.Length > 500)
        return Results.BadRequest(new { error = "invalid description" });
    if (string.IsNullOrWhiteSpace(request.Supplier) || request.Supplier.Length > 200)
        return Results.BadRequest(new { error = "invalid supplier" });
    if (string.IsNullOrWhiteSpace(request.DueDate) || !DateOnly.TryParseExact(request.DueDate, "yyyy-MM-dd", out _))
        return Results.BadRequest(new { error = "invalid due date" });

    var status = request.Status ?? oldStatus;
    if (status is not ("pending" or "delivered"))
        return Results.BadRequest(new { error = "invalid status" });

    var at = DateTimeOffset.UtcNow.ToString("O");
    var actor = Current(ctx).EmpNo;

    Store.Sql(db, "UPDATE project_external_dependencies SET description=$desc,supplier=$supp,due_date=$due,status=$status,updated_at=$at WHERE id=$id",
        ("$desc", request.Description.Trim()), ("$supp", request.Supplier.Trim()), ("$due", request.DueDate.Trim()), ("$status", status), ("$at", at), ("$id", depId)).ExecuteNonQuery();

    var action = (oldStatus != status && status == "delivered") ? "delivered" : "update";
    Store.Sql(db, "INSERT INTO project_external_dependency_history(external_dependency_id,actor,at,action,reason) VALUES($dep,$actor,$at,$action,$reason)",
        ("$dep", depId), ("$actor", actor), ("$at", at), ("$action", action), ("$reason", request.Reason?.Trim() ?? "更新跨部門相依事項")).ExecuteNonQuery();

    AdvanceProjectVersion(db, item);
    tx.Commit();
    return Results.Ok(new { projectVersion = item.Version + 1 });
});
app.MapPost("/api/items/{itemId}/external-dependencies/{depId}/links", (HttpContext ctx, Store store, string itemId, string depId, ExternalDependencyLinkRequest request) =>
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item)) return Results.StatusCode(403);
    if (item.Version == 0) return Results.BadRequest(new { error = "commit the project item before linking external dependencies" });

    var conflict = ScheduleWriteConflict(db, item, Current(ctx), new ScheduleRequest(null, null, null, null, null, null, null, null, null, null, null, null, null, request.Token, request.BaseProjectVersion, null, null, null));
    if (conflict is not null) return conflict;

    if (string.IsNullOrWhiteSpace(request.ScheduleEntryId))
        return Results.BadRequest(new { error = "schedule entry required" });
    if (string.IsNullOrWhiteSpace(request.Reason))
        return Results.BadRequest(new { error = "reason required" });

    // Validate external dependency exists and belongs to this project
    using var depRow = Store.Sql(db, "SELECT project_id, description, supplier FROM project_external_dependencies WHERE id=$id", ("$id", depId)).ExecuteReader();
    if (!depRow.Read()) return Results.NotFound();
    var depProjectId = depRow.GetString(0);
    var depDesc = depRow.GetString(1);
    var depSupp = depRow.GetString(2);
    depRow.Close();

    if (depProjectId != itemId)
        return Results.BadRequest(new { error = "cross project linking not allowed" });

    // Validate schedule entry exists and belongs to this project
    var entry = ScheduleEntry(db, request.ScheduleEntryId);
    if (entry is null || entry.ProjectId != itemId)
        return Results.BadRequest(new { error = "cross project or non-existent schedule entry" });

    // Check if already linked
    var exists = Store.Sql(db, "SELECT 1 FROM project_external_dependency_links WHERE external_dependency_id=$d AND schedule_entry_id=$e",
        ("$d", depId), ("$e", request.ScheduleEntryId)).ExecuteScalar() is not null;
    if (exists) return Results.BadRequest(new { error = "link already exists" });

    var linkId = Guid.NewGuid().ToString();
    var at = DateTimeOffset.UtcNow.ToString("O");
    var actor = Current(ctx).EmpNo;
    var reason = request.Reason.Trim();

    Store.Sql(db, "INSERT INTO project_external_dependency_links(id,project_id,external_dependency_id,schedule_entry_id,created_by,created_at,reason) VALUES($id,$project,$d,$e,$actor,$at,$reason)",
        ("$id", linkId), ("$project", itemId), ("$d", depId), ("$e", request.ScheduleEntryId), ("$actor", actor), ("$at", at), ("$reason", reason)).ExecuteNonQuery();

    // Record revision on affected schedule entry
    SaveScheduleRevision(db, request.ScheduleEntryId, actor, at, "link-external-dependency", $"關聯跨部門相依事項「{depDesc}」（{depSupp}）：{reason}", entry, entry);

    // Record history on external dependency
    Store.Sql(db, "INSERT INTO project_external_dependency_history(external_dependency_id,actor,at,action,reason,schedule_entry_id,schedule_entry_name) VALUES($dep,$actor,$at,'link',$reason,$entry,$name)",
        ("$dep", depId), ("$actor", actor), ("$at", at), ("$reason", reason), ("$entry", request.ScheduleEntryId), ("$name", entry.Name)).ExecuteNonQuery();

    AdvanceProjectVersion(db, item);
    tx.Commit();
    return Results.Created($"/api/items/{itemId}/external-dependencies/{depId}/links/{request.ScheduleEntryId}", new { id = linkId, projectVersion = item.Version + 1 });
});
app.MapPost("/api/items/{itemId}/external-dependencies/{depId}/links/delete", (HttpContext ctx, Store store, string itemId, string depId, ExternalDependencyLinkRequest request) =>
{
    return RemoveExternalLink(ctx, store, itemId, depId, request.ScheduleEntryId, request.Reason, request.Token, request.BaseProjectVersion);
});
app.MapDelete("/api/items/{itemId}/external-dependencies/{depId}/links/{scheduleEntryId}", (HttpContext ctx, Store store, string itemId, string depId, string scheduleEntryId, [Microsoft.AspNetCore.Mvc.FromQuery] string? reason, [Microsoft.AspNetCore.Mvc.FromQuery] string? token, [Microsoft.AspNetCore.Mvc.FromQuery] int? baseProjectVersion) =>
{
    return RemoveExternalLink(ctx, store, itemId, depId, scheduleEntryId, reason, token, baseProjectVersion);
});
app.MapGet("/api/reports/{reportId}/items/{itemId}/ecim-evidence-sources", (HttpContext ctx, Store store, string reportId, string itemId) =>
{
    var user = Current(ctx);
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (!CanReadPublication(user) && !CanEdit(user, item.OwnerSection)) return Results.StatusCode(403);
    using var rows = Store.Sql(db, "SELECT work_id, section, period_from, period_to, payload FROM ecim_sources WHERE report_id=$report ORDER BY rowid", ("$report", reportId)).ExecuteReader();
    var list = new List<EcimEvidenceCandidateSource>();
    while (rows.Read())
    {
        var workId = rows.GetString(0);
        var sec = rows.GetString(1);
        var pFrom = NullableString(rows, 2);
        var pTo = NullableString(rows, 3);
        var payload = rows.GetString(4);
        var summary = ExtractEcimSummary(payload, workId);
        list.Add(new EcimEvidenceCandidateSource(workId, sec, pFrom, pTo, summary, payload));
    }
    return Results.Ok(list);
});
app.MapGet("/api/items/{itemId}/schedule-entries/{entryId}/evidence-links", (HttpContext ctx, Store store, string itemId, string entryId) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (item.Section != "projects" || !CanMaintainProject(user, item) && !IsProjectParticipant(db, itemId, user.Section) && !CanReadPublication(user)) return Results.StatusCode(403);
    var entry = ScheduleEntry(db, entryId);
    if (entry is null || entry.ProjectId != itemId) return Results.NotFound();
    return Results.Ok(GetScheduleEvidenceLinks(db, entryId));
});
app.MapPost("/api/items/{itemId}/schedule-entries/{entryId}/evidence-links", (HttpContext ctx, Store store, string itemId, string entryId, ScheduleEvidenceLinkRequest request) =>
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item)) return Results.StatusCode(403);
    var entry = ScheduleEntry(db, entryId);
    if (entry is null || entry.ProjectId != itemId) return Results.NotFound();
    if (entry.Kind != "task") return Results.BadRequest(new { error = "eCIM evidence can only be linked to key tasks" });
    if (entry.State == "cancelled") return Results.BadRequest(new { error = "cannot link evidence to cancelled task" });
    if (string.IsNullOrWhiteSpace(request.WorkId)) return Results.BadRequest(new { error = "workId required" });
    if (string.IsNullOrWhiteSpace(request.Reason)) return Results.BadRequest(new { error = "reason required" });

    var conflict = ScheduleWriteConflict(db, item, Current(ctx), new ScheduleRequest(null, null, null, null, null, null, null, null, null, null, null, null, null, request.Token, request.BaseProjectVersion, null, null, null));
    if (conflict is not null) return conflict;

    var workId = request.WorkId.Trim();
    var duplicate = Store.Sql(db, "SELECT 1 FROM project_schedule_evidence_links WHERE schedule_entry_id=$entry AND work_id=$work", ("$entry", entryId), ("$work", workId)).ExecuteScalar();
    if (duplicate is not null) return Results.Conflict(new { error = "this eCIM work is already linked to this task" });

    var reportId = Store.Sql(db, "SELECT report_id FROM items WHERE id=$id", ("$id", itemId)).ExecuteScalar() as string ?? "";

    string? sourceId = null;
    string? section = request.Section;
    string? periodFrom = null;
    string? periodTo = null;
    string? payload = null;
    string summary = request.Summary?.Trim() ?? "";

    using (var srcRows = Store.Sql(db, "SELECT id, section, period_from, period_to, payload FROM ecim_sources WHERE report_id=$report AND work_id=$work ORDER BY rowid DESC LIMIT 1", ("$report", reportId), ("$work", workId)).ExecuteReader())
    {
        if (srcRows.Read())
        {
            sourceId = srcRows.GetString(0);
            section = NullableString(srcRows, 1) ?? section;
            periodFrom = NullableString(srcRows, 2);
            periodTo = NullableString(srcRows, 3);
            payload = srcRows.GetString(4);
            if (string.IsNullOrWhiteSpace(summary)) summary = ExtractEcimSummary(payload, workId);
        }
    }

    if (string.IsNullOrWhiteSpace(payload))
    {
        payload = System.Text.Json.JsonSerializer.Serialize(new { workId, summary = string.IsNullOrWhiteSpace(summary) ? workId : summary, section });
        if (string.IsNullOrWhiteSpace(summary)) summary = workId;
    }

    var linkId = Guid.NewGuid().ToString();
    var at = DateTimeOffset.UtcNow.ToString("O");
    var actor = Current(ctx).EmpNo;
    var beforeEntry = ScheduleEntry(db, entryId)!;

    Store.Sql(db, """
        INSERT INTO project_schedule_evidence_links(id,project_id,schedule_entry_id,work_id,source_id,section,summary,period_from,period_to,initial_payload,latest_payload,created_by,created_at,updated_at,reason)
        VALUES($id,$project,$entry,$work,$source,$sec,$sum,$pFrom,$pTo,$init,$latest,$actor,$at,$at,$reason)
        """,
        ("$id", linkId), ("$project", itemId), ("$entry", entryId), ("$work", workId),
        ("$source", sourceId), ("$sec", section), ("$sum", summary),
        ("$pFrom", periodFrom), ("$pTo", periodTo),
        ("$init", payload), ("$latest", payload),
        ("$actor", actor), ("$at", at), ("$reason", request.Reason.Trim())).ExecuteNonQuery();

    var afterEntry = ScheduleEntry(db, entryId)!;
    SaveScheduleRevision(db, entryId, actor, at, "link-evidence", $"連結 eCIM 證據「{workId}（{summary}）」：{request.Reason.Trim()}", beforeEntry, afterEntry);
    AdvanceProjectVersion(db, item);
    tx.Commit();

    var created = afterEntry.EvidenceLinks?.FirstOrDefault(l => l.Id == linkId);
    return Results.Created($"/api/items/{itemId}/schedule-entries/{entryId}/evidence-links/{linkId}", new { link = created, projectVersion = item.Version + 1 });
});
app.MapPost("/api/items/{itemId}/schedule-entries/{entryId}/evidence-links/{linkId}/delete", (HttpContext ctx, Store store, string itemId, string entryId, string linkId, ScheduleEvidenceUnlinkRequest request) =>
{
    return RemoveEvidenceLink(ctx, store, itemId, entryId, linkId, request.Reason, request.Token, request.BaseProjectVersion);
});
app.MapDelete("/api/items/{itemId}/schedule-entries/{entryId}/evidence-links/{linkId}", (HttpContext ctx, Store store, string itemId, string entryId, string linkId, [Microsoft.AspNetCore.Mvc.FromBody] ScheduleEvidenceUnlinkRequest? body, [Microsoft.AspNetCore.Mvc.FromQuery] string? reason, [Microsoft.AspNetCore.Mvc.FromQuery] string? token, [Microsoft.AspNetCore.Mvc.FromQuery] int? baseProjectVersion) =>
{
    var r = body?.Reason ?? reason;
    var t = body?.Token ?? token;
    var v = body?.BaseProjectVersion ?? baseProjectVersion;
    return RemoveEvidenceLink(ctx, store, itemId, entryId, linkId, r, t, v);
});
app.MapGet("/api/items/{itemId}/schedule/{entryId}/baseline-history", (HttpContext ctx, Store store, string itemId, string entryId) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (item.Section != "projects" || !CanMaintainProject(user, item) && !IsProjectParticipant(db, itemId, user.Section)) return Results.StatusCode(403);
    var entry = ScheduleEntry(db, entryId);
    if (entry is null || entry.ProjectId != itemId) return Results.NotFound();
    using var rows = Store.Sql(db, "SELECT actor,at,before_baseline_start,before_baseline_end,after_baseline_start,after_baseline_end,reason FROM project_baseline_history WHERE entry_id=$entry ORDER BY id", ("$entry", entryId)).ExecuteReader();
    var history = new List<object>();
    while (rows.Read()) history.Add(new { actor = rows.GetString(0), at = rows.GetString(1), beforeBaselineStart = NullableString(rows, 2), beforeBaselineEnd = NullableString(rows, 3), afterBaselineStart = NullableString(rows, 4), afterBaselineEnd = NullableString(rows, 5), reason = rows.GetString(6) });
    return Results.Ok(history);
});
app.MapGet("/api/items/{itemId}/schedule/{entryId}/history", (HttpContext ctx, Store store, string itemId, string entryId) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (item.Section != "projects" || !CanMaintainProject(user, item) && !IsProjectParticipant(db, itemId, user.Section)) return Results.StatusCode(403);
    var entry = ScheduleEntry(db, entryId);
    if (entry is null || entry.ProjectId != itemId) return Results.NotFound();
    return Results.Ok(GetScheduleRevisions(db, entryId));
});
app.MapGet("/api/items/{itemId}", (HttpContext ctx, Store store, string itemId) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (!CanEdit(Current(ctx), item.OwnerSection)) return Results.StatusCode(403);
    if (item.Version == 0 && item.Section != "personnel" && Current(ctx).EmpNo != Creator(db, itemId)) return Results.NotFound();
    return Results.Ok(new { item.Id, item.ContinuityId, item.Section, item.OwnerSection, item.Title, item.Content, item.Status, item.Version, lease = LeaseObject(GetLease(db, itemId)) });
});
app.MapPost("/api/items/{itemId}/lease", (HttpContext ctx, Store store, IConfiguration config, string itemId) =>
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (!CanEdit(user, item.OwnerSection)) return Results.StatusCode(403);
    var lease = GetLease(db, itemId);
    if (lease is not null && lease.ExpiresAt > DateTimeOffset.UtcNow) return Conflict(db, itemId, user.EmpNo, "lease held", lease);
    var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    var expires = DateTimeOffset.UtcNow.AddSeconds(LeaseSeconds(config));
    Store.Sql(db, "INSERT INTO leases(item_id,holder,token_hash,expires_at,base_version) VALUES($id,$actor,$hash,$expires,$version) ON CONFLICT(item_id) DO UPDATE SET holder=excluded.holder,token_hash=excluded.token_hash,expires_at=excluded.expires_at,base_version=excluded.base_version",
        ("$id", itemId), ("$actor", user.EmpNo), ("$hash", Hash(token)), ("$expires", expires.ToString("O")), ("$version", item.Version)).ExecuteNonQuery();
    tx.Commit();
    return Results.Ok(new { token, expiresAt = expires, baseVersion = item.Version });
});
app.MapPost("/api/items/{itemId}/lease/renew", (HttpContext ctx, Store store, IConfiguration config, string itemId, TokenRequest request) => ChangeLease(ctx, store, config, itemId, request.Token, false));
app.MapDelete("/api/items/{itemId}/lease", (HttpContext ctx, Store store, IConfiguration config, string itemId, [FromBody] TokenRequest request) => ChangeLease(ctx, store, config, itemId, request.Token, true));
app.MapPost("/api/items/{itemId}/lease/takeover", (HttpContext ctx, Store store, IConfiguration config, string itemId, TakeoverRequest request) =>
{
    var user = Current(ctx);
    if (user.Role != "Guy") return Results.StatusCode(403);
    if (string.IsNullOrWhiteSpace(request.Reason)) return Results.BadRequest(new { error = "reason required" });
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
    var expires = DateTimeOffset.UtcNow.AddSeconds(LeaseSeconds(config));
    Store.Sql(db, "INSERT INTO leases(item_id,holder,token_hash,expires_at,base_version) VALUES($id,$actor,$hash,$expires,$version) ON CONFLICT(item_id) DO UPDATE SET holder=excluded.holder,token_hash=excluded.token_hash,expires_at=excluded.expires_at,base_version=excluded.base_version",
        ("$id", itemId), ("$actor", user.EmpNo), ("$hash", Hash(token)), ("$expires", expires.ToString("O")), ("$version", item.Version)).ExecuteNonQuery();
    Store.Sql(db, "INSERT INTO audit(item_id,actor,at,action,reason) VALUES($id,$actor,$at,'takeover',$reason)",
        ("$id", itemId), ("$actor", user.EmpNo), ("$at", DateTimeOffset.UtcNow.ToString("O")), ("$reason", request.Reason.Trim())).ExecuteNonQuery();
    tx.Commit();
    return Results.Ok(new { token, expiresAt = expires, baseVersion = item.Version });
});
app.MapGet("/api/items/{itemId}/private-draft", (HttpContext ctx, Store store, string itemId) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (!CanEdit(user, item.OwnerSection)) return Results.StatusCode(403);
    using var rows = Store.Sql(db, "SELECT title,content,details,status,saved_at FROM drafts WHERE item_id=$id AND editor=$actor", ("$id", itemId), ("$actor", user.EmpNo)).ExecuteReader();
    return rows.Read() ? Results.Ok(new { title = rows.GetString(0), content = rows.GetString(1), details = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(rows.GetString(2)), status = rows.GetString(3), savedAt = rows.GetString(4) }) : Results.NotFound();
});
app.MapPut("/api/items/{itemId}/private-draft", (HttpContext ctx, Store store, string itemId, DraftRequest request) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (!CanEdit(user, item.OwnerSection)) return Results.StatusCode(403);
    var status = request.Status ?? item.Status;
    var details = request.Details?.GetRawText() ?? item.Details;
    if (!Valid(request.Title, request.Content) || !ValidStatus(status, request.Content, item.Section) || !ValidDetails(item.Section, request.Content, details, status) || !ValidDecisionTransition(item.Details, details)) return Results.BadRequest();
    Store.Sql(db, "INSERT INTO drafts(item_id,editor,title,content,details,status,saved_at) VALUES($id,$actor,$title,$content,$details,$status,$at) ON CONFLICT(item_id,editor) DO UPDATE SET title=excluded.title,content=excluded.content,details=excluded.details,status=excluded.status,saved_at=excluded.saved_at",
        ("$id", itemId), ("$actor", user.EmpNo), ("$title", request.Title.Trim()), ("$content", request.Content), ("$details", details), ("$status", status), ("$at", DateTimeOffset.UtcNow.ToString("O"))).ExecuteNonQuery();
    return Results.NoContent();
});
app.MapPost("/api/items/{itemId}/commit", (HttpContext ctx, Store store, string itemId, CommitRequest request) =>
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (!CanEdit(user, item.OwnerSection)) return Results.StatusCode(403);
    var lease = GetLease(db, itemId);
    if (lease is null || lease.Holder != user.EmpNo || lease.ExpiresAt <= DateTimeOffset.UtcNow || !Matches(request.Token, lease.TokenHash) || request.BaseVersion != item.Version || lease.BaseVersion != item.Version)
        return Conflict(db, itemId, user.EmpNo, "stale lease or version", lease);
    using var draftRows = Store.Sql(db, "SELECT title,content,details,status FROM drafts WHERE item_id=$id AND editor=$actor", ("$id", itemId), ("$actor", user.EmpNo)).ExecuteReader();
    if (!draftRows.Read()) return Results.BadRequest(new { error = "private draft required" });
    var title = draftRows.GetString(0);
    var content = draftRows.GetString(1);
    var details = draftRows.GetString(2); var draftStatus = draftRows.GetString(3);
    draftRows.Close();
    var status = request.Status ?? draftStatus;
    if (!Valid(title, content) || !ValidStatus(status, content, item.Section) || !ValidDetails(item.Section, content, details, status) || !ValidDecisionTransition(item.Details, details)) return Results.BadRequest();
    if (item.Section == "personnel")
    {
        using var personnelDetails = System.Text.Json.JsonDocument.Parse(details);
        title = Text(personnelDetails.RootElement, "handover")!;
    }
    Store.Sql(db, "UPDATE items SET title=$title,content=$content,details=$details,status=$status,version=version+1 WHERE id=$id AND version=$version", ("$title", title), ("$content", content), ("$details", details), ("$status", status), ("$id", itemId), ("$version", item.Version)).ExecuteNonQuery();
    var origin = GetFieldOrigin(db, itemId);
    if (origin is not null && origin.ReportValue != content) UpsertFieldOrigin(db, itemId, origin.LatestSourceValue, origin.LatestSourceValue, content, true);
    Store.Sql(db, "INSERT INTO revisions(item_id,actor,at,before_version,after_version,before_title,after_title,before_content,after_content,before_details,after_details) VALUES($id,$actor,$at,$before,$after,$oldTitle,$newTitle,$oldContent,$newContent,$oldDetails,$newDetails)",
        ("$id", itemId), ("$actor", user.EmpNo), ("$at", DateTimeOffset.UtcNow.ToString("O")), ("$before", item.Version), ("$after", item.Version + 1), ("$oldTitle", item.Title), ("$newTitle", title), ("$oldContent", item.Content), ("$newContent", content), ("$oldDetails", item.Details), ("$newDetails", details)).ExecuteNonQuery();
    Store.Sql(db, "INSERT INTO audit(item_id,actor,at,action) VALUES($id,$actor,$at,'commit')",
        ("$id", itemId), ("$actor", user.EmpNo), ("$at", DateTimeOffset.UtcNow.ToString("O"))).ExecuteNonQuery();
    Store.Sql(db, "DELETE FROM leases WHERE item_id=$id", ("$id", itemId)).ExecuteNonQuery();
    Store.Sql(db, "DELETE FROM drafts WHERE item_id=$id AND editor=$actor", ("$id", itemId), ("$actor", user.EmpNo)).ExecuteNonQuery();
    tx.Commit();
    return Results.Ok(new { version = item.Version + 1 });
});
app.MapGet("/api/items/{itemId}/history", (HttpContext ctx, Store store, string itemId) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (!CanEdit(Current(ctx), item.OwnerSection)) return Results.StatusCode(403);
    var history = new List<object>();
    using (var rows = Store.Sql(db, "SELECT actor,at,before_version,after_version,before_title,after_title,before_content,after_content,before_details,after_details FROM revisions WHERE item_id=$id ORDER BY id", ("$id", itemId)).ExecuteReader())
        while (rows.Read()) history.Add(new { action = "commit", actor = rows.GetString(0), at = rows.GetString(1), beforeVersion = rows.GetInt32(2), afterVersion = rows.GetInt32(3), beforeTitle = rows.GetString(4), afterTitle = rows.GetString(5), beforeContent = rows.GetString(6), afterContent = rows.GetString(7), beforeDetails = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(rows.GetString(8)), afterDetails = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(rows.GetString(9)) });
    using (var rows = Store.Sql(db, "SELECT actor,at,reason FROM audit WHERE item_id=$id AND action='takeover' ORDER BY id", ("$id", itemId)).ExecuteReader())
        while (rows.Read()) history.Add(new { action = "takeover", actor = rows.GetString(0), at = rows.GetString(1), reason = rows.GetString(2) });
    return Results.Ok(history);
});

if (Directory.Exists(webRoot)) app.MapFallback(async context =>
{
    if (context.Request.Path.StartsWithSegments("/api")) { context.Response.StatusCode = 404; return; }
    context.Response.ContentType = "text/html; charset=utf-8";
    await context.Response.SendFileAsync(Path.Combine(webRoot, "index.html"));
});
app.Run();

static User Current(HttpContext context)
{
    return (User)context.Items["user"]!;
}


static bool Editor(User user) => user.Role is "Guy" or "Head";
static List<EcimMember> EcimMembers(IConfiguration config) => config.GetSection("Ecim:Members").GetChildren()
    .Select(member => new EcimMember(member["Section"] ?? "", member["UserId"] ?? "", member["UpdateDateFrom"], member["UpdateDateTo"], member["TimeFrom"], member["TimeTo"], member["Division"], member["Dept"], member["TeamId"]))
    .Where(member => !string.IsNullOrWhiteSpace(member.Section) && !string.IsNullOrWhiteSpace(member.UserId)).ToList();
static bool CanReadPublication(User user) => user.Role == "Guy" || user.ReaderAccess;
static bool CanEdit(User user, string ownerSection) => user.Role == "Guy" || user.Role == "Head" && user.Section == ownerSection;
static bool CanMaintainProject(User user, Item item) => item.Section == "projects" && CanEdit(user, item.OwnerSection);
static string GetUserName(SqliteConnection db, string? empNo)
{
    if (string.IsNullOrWhiteSpace(empNo)) return "";
    return Store.Sql(db, "SELECT name FROM users WHERE emp_no=$emp", ("$emp", empNo)).ExecuteScalar() as string ?? empNo;
}
static bool MatchOwner(string? ownerText, User user)
{
    if (string.IsNullOrWhiteSpace(ownerText)) return false;
    var trimmed = ownerText.Trim();
    if (trimmed.Equals(user.EmpNo, StringComparison.OrdinalIgnoreCase) ||
        trimmed.Equals(user.Name, StringComparison.OrdinalIgnoreCase))
        return true;

    var tokens = trimmed.Split(new[] { ' ', '\t', ',', '/', ';', '、', '(', ')', '（', '）', '[', ']' }, StringSplitOptions.RemoveEmptyEntries);
    return tokens.Any(t => t.Equals(user.EmpNo, StringComparison.OrdinalIgnoreCase) ||
                           t.Equals(user.Name, StringComparison.OrdinalIgnoreCase));
}

static bool IsTaskOwner(ScheduleEntry entry, User user) => MatchOwner(entry.Owner, user);

static bool IsTaskOwnerInProject(SqliteConnection db, string projectId, User user)
{
    using var rows = Store.Sql(db, "SELECT owner FROM project_schedule_entries WHERE project_id=$p AND owner IS NOT NULL", ("$p", projectId)).ExecuteReader();
    while (rows.Read())
    {
        if (MatchOwner(rows.GetString(0), user))
            return true;
    }
    return false;
}

static bool CanReadProject(SqliteConnection db, Item item, User user)
{
    if (user.Role == "Guy") return true;
    if (CanMaintainProject(user, item)) return true;
    if (IsProjectParticipant(db, item.Id, user.Section)) return true;
    if (IsTaskOwnerInProject(db, item.Id, user)) return true;
    return false;
}

static bool CanSubmitProposal(SqliteConnection db, Item item, ScheduleEntry entry, User user)
{
    if (user.Role == "Reader") return false;
    if (CanMaintainProject(user, item)) return true;
    if (user.Role == "Head" && IsProjectParticipant(db, item.Id, user.Section)) return true;
    if (IsTaskOwner(entry, user)) return true;
    return false;
}

static string ResolveProposalSourceOrigin(User user, Item item, ScheduleEntry entry, string? customOrigin)
{
    if (!string.IsNullOrWhiteSpace(customOrigin)) return customOrigin.Trim();
    if (CanMaintainProject(user, item))
    {
        return $"維護人代為記錄（負責人：{entry.Owner ?? "未指定"}）";
    }
    return $"{user.Name} ({user.EmpNo})";
}

static (string Id, string SourceOrigin) CreateProposalRecord(
    SqliteConnection db,
    string itemId,
    ScheduleEntry entry,
    User user,
    int? progressPercent,
    string workDescription,
    string? proposedStart,
    string? proposedEnd,
    string? proposedDate,
    string? proposedState,
    string sourceOrigin,
    string at,
    string historyAction,
    string historyReason)
{
    var proposalId = Guid.NewGuid().ToString();
    Store.Sql(db, """
        INSERT INTO project_proposals(id, project_id, schedule_entry_id, progress_percent, work_description, proposed_start, proposed_end, proposed_date, proposed_state, source_origin, status, created_by, created_at)
        VALUES($id, $proj, $entry, $prog, $work, $pstart, $pend, $pdate, $pstate, $origin, 'pending', $creator, $at)
        """,
        ("$id", proposalId), ("$proj", itemId), ("$entry", entry.Id),
        ("$prog", progressPercent), ("$work", workDescription),
        ("$pstart", proposedStart), ("$pend", proposedEnd),
        ("$pdate", proposedDate), ("$pstate", proposedState),
        ("$origin", sourceOrigin), ("$creator", user.EmpNo), ("$at", at)).ExecuteNonQuery();

    Store.Sql(db, "INSERT INTO project_proposal_history(proposal_id, actor, at, action, reason, details) VALUES($pid, $actor, $at, $action, $reason, $details)",
        ("$pid", proposalId), ("$actor", user.EmpNo), ("$at", at), ("$action", historyAction), ("$reason", historyReason), ("$details", workDescription)).ExecuteNonQuery();

    Store.Sql(db, "INSERT INTO audit(item_id, actor, at, action, reason) VALUES($id, $actor, $at, 'project-proposal', $reason)",
        ("$id", itemId), ("$actor", user.EmpNo), ("$at", at), ("$reason", $"提交任務「{entry.Name}」時程提案：{workDescription}")).ExecuteNonQuery();

    return (proposalId, sourceOrigin);
}
static List<ProjectProposalView> GetProjectProposals(SqliteConnection db, string projectId)
{
    var list = new List<ProjectProposalView>();
    using var rows = Store.Sql(db, """
        SELECT p.id, p.project_id, p.schedule_entry_id, e.name, e.kind, e.owner,
               p.progress_percent, p.work_description, p.proposed_start, p.proposed_end, p.proposed_date, p.proposed_state,
               p.source_origin, p.status, p.created_by, p.created_at,
               p.decided_by, p.decided_at, p.decision_reason,
               e.baseline_start, e.baseline_end, e.forecast_start, e.forecast_end,
               e.baseline_date, e.forecast_date, e.state
        FROM project_proposals p
        JOIN project_schedule_entries e ON e.id = p.schedule_entry_id
        WHERE p.project_id = $project
        ORDER BY p.rowid DESC
        """, ("$project", projectId)).ExecuteReader();

    while (rows.Read())
    {
        var createdBy = rows.GetString(14);
        var decidedBy = rows.IsDBNull(16) ? null : rows.GetString(16);
        list.Add(new ProjectProposalView(
            rows.GetString(0),
            rows.GetString(1),
            rows.GetString(2),
            rows.GetString(3),
            rows.GetString(4),
            rows.IsDBNull(5) ? null : rows.GetString(5),
            rows.IsDBNull(6) ? null : rows.GetInt32(6),
            rows.GetString(7),
            rows.IsDBNull(8) ? null : rows.GetString(8),
            rows.IsDBNull(9) ? null : rows.GetString(9),
            rows.IsDBNull(10) ? null : rows.GetString(10),
            rows.IsDBNull(11) ? null : rows.GetString(11),
            rows.IsDBNull(12) ? null : rows.GetString(12),
            rows.GetString(13),
            createdBy,
            GetUserName(db, createdBy),
            rows.GetString(15),
            decidedBy,
            decidedBy is null ? null : GetUserName(db, decidedBy),
            rows.IsDBNull(17) ? null : rows.GetString(17),
            rows.IsDBNull(18) ? null : rows.GetString(18),
            rows.IsDBNull(19) ? null : rows.GetString(19),
            rows.IsDBNull(20) ? null : rows.GetString(20),
            rows.IsDBNull(21) ? null : rows.GetString(21),
            rows.IsDBNull(22) ? null : rows.GetString(22),
            rows.IsDBNull(23) ? null : rows.GetString(23),
            rows.IsDBNull(24) ? null : rows.GetString(24),
            rows.GetString(25)
        ));
    }
    return list;
}
static bool IsProjectParticipant(SqliteConnection db, string itemId, string? section) => !string.IsNullOrWhiteSpace(section) && Store.Sql(db, "SELECT 1 FROM project_participants WHERE project_id=$project AND section=$section", ("$project", itemId), ("$section", section)).ExecuteScalar() is not null;
static bool ValidSection(SqliteConnection db, string? section) => !string.IsNullOrWhiteSpace(section) && Store.Sql(db, "SELECT 1 FROM users WHERE role='Head' AND section=$section", ("$section", section.Trim())).ExecuteScalar() is not null;
static bool Valid(string? title, string? content) => !string.IsNullOrWhiteSpace(title) && title.Length <= 200 && content is not null && content.Length <= 20000;
static bool ValidProjectWork(string? work, string? scheduleProposal) => !string.IsNullOrWhiteSpace(work) && work.Length <= 20000 && (scheduleProposal is null || scheduleProposal.Length <= 2000);
static bool ValidScheduleRange(ScheduleRequest request) =>
    !string.IsNullOrWhiteSpace(request.Name) && request.Name.Length <= 200 &&
    request.BaselineStart is not null && ValidDateRange(request.BaselineStart, request.BaselineEnd) &&
    request.ForecastStart is not null && ValidDateRange(request.ForecastStart, request.ForecastEnd) &&
    (request.ActualStart is null || DateOnly.TryParseExact(request.ActualStart, "yyyy-MM-dd", out _)) &&
    (request.ActualEnd is null || DateOnly.TryParseExact(request.ActualEnd, "yyyy-MM-dd", out _)) &&
    (request.ActualStart is null || request.ActualEnd is null || string.CompareOrdinal(request.ActualStart, request.ActualEnd) <= 0) &&
    (request.State switch
    {
        "open" => request.ActualStart is null && request.ActualEnd is null,
        "in-progress" => request.ActualStart is not null && request.ActualEnd is null,
        "completed" => request.ActualStart is not null && request.ActualEnd is not null,
        "cancelled" => request.ActualEnd is null,
        _ => false
    });
static bool ValidTaskFields(SqliteConnection db, string projectId, ScheduleRequest request, ScheduleEntry? current)
{
    if (request.Kind == "phase") return request.Owner is null && request.PhaseId is null;
    if (request.Kind != "task" || string.IsNullOrWhiteSpace(request.Owner) || request.Owner.Length > 200) return false;
    if (request.PhaseId is null) return true;
    var phaseState = Store.Sql(db, "SELECT state FROM project_schedule_entries WHERE id=$phase AND project_id=$project AND kind='phase'", ("$phase", request.PhaseId), ("$project", projectId)).ExecuteScalar() as string;
    return phaseState is not (null or "cancelled") &&
        (phaseState != "completed" || request.State == "completed" || current?.PhaseId == request.PhaseId && current.State != "completed");
}
static IResult ScheduleConflict(SqliteConnection db, string itemId, int version, string error) =>
    Results.Conflict(new { error, latest = new { projectVersion = version, schedule = ScheduleEntries(db, itemId) } });
static IResult? ScheduleWriteConflict(SqliteConnection db, Item item, User user, ScheduleRequest request)
{
    var lease = GetLease(db, item.Id);
    if (lease is null || lease.Holder != user.EmpNo || lease.ExpiresAt <= DateTimeOffset.UtcNow || !Matches(request.Token ?? "", lease.TokenHash) || request.BaseProjectVersion != item.Version || lease.BaseVersion != item.Version)
        return ScheduleConflict(db, item.Id, item.Version, "stale lease or project version");
    return null;
}
static void AdvanceProjectVersion(SqliteConnection db, Item item)
{
    Store.Sql(db, "UPDATE items SET version=version+1 WHERE id=$id AND version=$version", ("$id", item.Id), ("$version", item.Version)).ExecuteNonQuery();
    Store.Sql(db, "UPDATE leases SET base_version=$next WHERE item_id=$id", ("$next", item.Version + 1), ("$id", item.Id)).ExecuteNonQuery();
}
static void SaveScheduleRevision(SqliteConnection db, string entryId, string actor, string at, string action, string? reason, ScheduleEntry? before, ScheduleEntry after) =>
    Store.Sql(db, "INSERT INTO project_schedule_revisions(entry_id,actor,at,action,reason,before_state,after_state) VALUES($entry,$actor,$at,$action,$reason,$before,$after)",
        ("$entry", entryId), ("$actor", actor), ("$at", at), ("$action", action), ("$reason", reason), ("$before", before is null ? null : System.Text.Json.JsonSerializer.Serialize(before, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web))), ("$after", System.Text.Json.JsonSerializer.Serialize(after, new System.Text.Json.JsonSerializerOptions(System.Text.Json.JsonSerializerDefaults.Web)))).ExecuteNonQuery();
static (string Type, string Reason) CandidateClassification(string payload)
{
    using var document = System.Text.Json.JsonDocument.Parse(payload);
    var status = Text(document.RootElement, "status") ?? Text(document.RootElement, "state") ?? "";
    var description = Text(document.RootElement, "summary") ?? Text(document.RootElement, "description") ?? "";
    if (status.Contains("complete", StringComparison.OrdinalIgnoreCase) || status.Contains("done", StringComparison.OrdinalIgnoreCase)) return ("suspected-complete", "疑似完成");
    if (description.Contains("異常", StringComparison.OrdinalIgnoreCase) || description.Contains("error", StringComparison.OrdinalIgnoreCase) || description.Contains("incident", StringComparison.OrdinalIgnoreCase)) return ("anomaly-alert", "異常提示");
    return ("source-change", "來源進度或狀態變更");
}
static bool ValidDateRange(string? start, string? end)
{
    if (start is null && end is null) return true;
    if (start is null || end is null || !DateOnly.TryParseExact(start, "yyyy-MM-dd", out var startDate) || !DateOnly.TryParseExact(end, "yyyy-MM-dd", out var endDate)) return false;
    return startDate <= endDate;
}
static bool ValidStatus(string status, string content, string section) => status is "open" or "closed" && (status != "closed" || section == "personnel" || !string.IsNullOrWhiteSpace(content));
static bool ValidDetails(string section, string content, string details, string status)
{
    try
    {
        using var document = System.Text.Json.JsonDocument.Parse(details);
        var root = document.RootElement;
        if (root.ValueKind != System.Text.Json.JsonValueKind.Object) return false;
        if (section == "personnel")
        {
            if (!string.IsNullOrWhiteSpace(content) || root.EnumerateObject().Any(property => !new[] { "effectiveDate", "handover", "impact", "nextStep" }.Contains(property.Name))) return false;
            return Text(root, "effectiveDate") is { } date && DateOnly.TryParseExact(date, "yyyy-MM-dd", out _) && new[] { "handover", "impact", "nextStep" }.All(name => !string.IsNullOrWhiteSpace(Text(root, name)));
        }
        if (root.TryGetProperty("sourceLinks", out var links) && (links.ValueKind != System.Text.Json.JsonValueKind.Array || links.EnumerateArray().Any(link => link.ValueKind != System.Text.Json.JsonValueKind.Object || !Uri.TryCreate(Text(link, "url"), UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https")))) return false;
        if (!root.TryGetProperty("pendingDecision", out var decision)) return true;
        if (decision.ValueKind != System.Text.Json.JsonValueKind.Object || string.IsNullOrWhiteSpace(Text(decision, "description"))) return false;
        var due = Text(decision, "newDueDate");
        if (due is not null && !DateOnly.TryParseExact(due, "yyyy-MM-dd", out _)) return false;
        return status != "closed" || !string.IsNullOrWhiteSpace(Text(decision, "result"));
    }
    catch { return false; }
}
static string? Text(System.Text.Json.JsonElement value, string name) => value.TryGetProperty(name, out var property) && property.ValueKind == System.Text.Json.JsonValueKind.String ? property.GetString() : null;
static bool ValidPublicationDetails(PublishedItem item)
{
    using var document = System.Text.Json.JsonDocument.Parse(item.Details);
    var root = document.RootElement;
    return !root.TryGetProperty("pendingDecision", out var decision) || !decision.TryGetProperty("requiresFollowUp", out var required) || required.ValueKind != System.Text.Json.JsonValueKind.True || !string.IsNullOrWhiteSpace(Text(decision, "result")) || !string.IsNullOrWhiteSpace(Text(decision, "newDueDate"));
}
static bool ValidDecisionTransition(string before, string after)
{
    using var previous = System.Text.Json.JsonDocument.Parse(before);
    if (!previous.RootElement.TryGetProperty("pendingDecision", out var oldDecision) || !oldDecision.TryGetProperty("requiresFollowUp", out var required) || required.ValueKind != System.Text.Json.JsonValueKind.True) return true;
    using var proposed = System.Text.Json.JsonDocument.Parse(after);
    return proposed.RootElement.TryGetProperty("pendingDecision", out var newDecision) && newDecision.TryGetProperty("requiresFollowUp", out var stillRequired) && stillRequired.ValueKind == System.Text.Json.JsonValueKind.True && Text(newDecision, "description") == Text(oldDecision, "description");
}
static string CarryDetails(PublishedItem item)
{
    var details = System.Text.Json.Nodes.JsonNode.Parse(item.Details) as System.Text.Json.Nodes.JsonObject ?? new();
    if (item.Section != "personnel")
    {
        details["previousCommitment"] = item.Content;
        if (details["pendingDecision"] is System.Text.Json.Nodes.JsonObject decision && string.IsNullOrWhiteSpace((string?)decision["result"]))
        {
            decision["requiresFollowUp"] = true;
            decision.Remove("newDueDate");
        }
    }
    return details.ToJsonString();
}
static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(token)));
static bool Matches(string token, string hash) => !string.IsNullOrWhiteSpace(token) && CryptographicOperations.FixedTimeEquals(Convert.FromHexString(Hash(token)), Convert.FromHexString(hash));
static int LeaseSeconds(IConfiguration config) => Math.Max(1, config.GetValue<int?>("LeaseDurationSeconds") ?? 1800);

static Item? GetItem(SqliteConnection db, string id)
{
    using var rows = Store.Sql(db, "SELECT id,continuity_id,section,owner_section,title,content,details,status,version FROM items WHERE id=$id", ("$id", id)).ExecuteReader();
    return rows.Read() ? new Item(rows.GetString(0), rows.GetString(1), rows.GetString(2), rows.GetString(3), rows.GetString(4), rows.GetString(5), rows.GetString(6), rows.GetString(7), rows.GetInt32(8)) : null;
}
static string? Creator(SqliteConnection db, string id) => Store.Sql(db, "SELECT created_by FROM items WHERE id=$id", ("$id", id)).ExecuteScalar() as string;
static Lease? GetLease(SqliteConnection db, string id)
{
    using var rows = Store.Sql(db, "SELECT holder,token_hash,expires_at,base_version FROM leases WHERE item_id=$id", ("$id", id)).ExecuteReader();
    return rows.Read() ? new Lease(rows.GetString(0), rows.GetString(1), DateTimeOffset.Parse(rows.GetString(2)), rows.GetInt32(3)) : null;
}
static object? LeaseView(SqliteDataReader rows, int holderColumn) => rows.IsDBNull(holderColumn) ? null : new { holder = rows.GetString(holderColumn), expiresAt = rows.GetString(holderColumn + 1) };
static object? LeaseObject(Lease? lease) => lease is null ? null : new { holder = lease.Holder, expiresAt = lease.ExpiresAt };
static string? NullableString(SqliteDataReader rows, int ordinal) => rows.IsDBNull(ordinal) ? null : rows.GetString(ordinal);
static FieldOrigin? GetFieldOrigin(SqliteConnection db, string itemId)
{
    using var rows = Store.Sql(db, "SELECT last_source_value,latest_source_value,report_value,human_override FROM field_origins WHERE item_id=$item AND field_name='content'", ("$item", itemId)).ExecuteReader();
    return rows.Read() ? new FieldOrigin(NullableString(rows, 0), rows.GetString(1), rows.GetString(2), rows.GetInt32(3) == 1) : null;
}
static void UpsertFieldOrigin(SqliteConnection db, string itemId, string? lastSourceValue, string latestSourceValue, string reportValue, bool humanOverride) =>
    Store.Sql(db, "INSERT INTO field_origins(item_id,field_name,last_source_value,latest_source_value,report_value,human_override,edited_at) VALUES($item,'content',$last,$latest,$report,$override,$at) ON CONFLICT(item_id,field_name) DO UPDATE SET last_source_value=excluded.last_source_value,latest_source_value=excluded.latest_source_value,report_value=excluded.report_value,human_override=excluded.human_override,edited_at=excluded.edited_at",
        ("$item", itemId), ("$last", lastSourceValue), ("$latest", latestSourceValue), ("$report", reportValue), ("$override", humanOverride ? 1 : 0), ("$at", DateTimeOffset.UtcNow.ToString("O"))).ExecuteNonQuery();
static bool HasDependencyCycle(SqliteConnection db, string projectId, string predecessorId, string successorId)
{
    if (predecessorId == successorId) return true;
    var adj = new Dictionary<string, List<string>>();
    using var rows = Store.Sql(db, "SELECT predecessor_id, successor_id FROM project_schedule_dependencies WHERE project_id=$project", ("$project", projectId)).ExecuteReader();
    while (rows.Read())
    {
        var p = rows.GetString(0);
        var s = rows.GetString(1);
        if (!adj.TryGetValue(p, out var list)) adj[p] = list = [];
        list.Add(s);
    }
    var queue = new Queue<string>();
    var visited = new HashSet<string>();
    queue.Enqueue(successorId);
    visited.Add(successorId);
    while (queue.Count > 0)
    {
        var curr = queue.Dequeue();
        if (curr == predecessorId) return true;
        if (adj.TryGetValue(curr, out var nexts))
        {
            foreach (var n in nexts)
            {
                if (visited.Add(n)) queue.Enqueue(n);
            }
        }
    }
    return false;
}
static void NotifySuccessorsOfPredecessorChange(SqliteConnection db, string itemId, string entryId, string actor, string at, string reason)
{
    var current = ScheduleEntry(db, entryId);
    if (current is null) return;
    var succIds = new List<string>();
    using (var succRows = Store.Sql(db, "SELECT successor_id FROM project_schedule_dependencies WHERE predecessor_id=$id", ("$id", entryId)).ExecuteReader())
    {
        while (succRows.Read()) succIds.Add(succRows.GetString(0));
    }
    foreach (var sId in succIds)
    {
        var succEntry = ScheduleEntry(db, sId);
        if (succEntry != null)
        {
            SaveScheduleRevision(db, sId, actor, at, "predecessor-updated", $"前置項目「{current.Name}」計畫變動：{reason}", succEntry, succEntry);
        }
    }
}
static IResult RemoveDependency(HttpContext ctx, Store store, string itemId, string? predecessorId, string? successorId, string? reason, string? token, int? baseProjectVersion)
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item)) return Results.StatusCode(403);
    var conflict = ScheduleWriteConflict(db, item, Current(ctx), new ScheduleRequest(null, null, null, null, null, null, null, null, null, null, null, null, null, token, baseProjectVersion, null, null, null));
    if (conflict is not null) return conflict;

    if (string.IsNullOrWhiteSpace(predecessorId) || string.IsNullOrWhiteSpace(successorId))
        return Results.BadRequest(new { error = "predecessor and successor required" });
    if (string.IsNullOrWhiteSpace(reason))
        return Results.BadRequest(new { error = "reason required" });

    var exists = Store.Sql(db, "SELECT 1 FROM project_schedule_dependencies WHERE project_id=$project AND predecessor_id=$p AND successor_id=$s", ("$project", itemId), ("$p", predecessorId), ("$s", successorId)).ExecuteScalar() is not null;
    if (!exists) return Results.NotFound();

    var pred = ScheduleEntry(db, predecessorId);
    var succ = ScheduleEntry(db, successorId);
    if (pred is null || succ is null) return Results.NotFound();

    Store.Sql(db, "DELETE FROM project_schedule_dependencies WHERE project_id=$project AND predecessor_id=$p AND successor_id=$s", ("$project", itemId), ("$p", predecessorId), ("$s", successorId)).ExecuteNonQuery();

    var at = DateTimeOffset.UtcNow.ToString("O");
    var actor = Current(ctx).EmpNo;
    var trimmedReason = reason.Trim();

    SaveScheduleRevision(db, predecessorId, actor, at, "unlink-dependency", $"解除後續項目「{succ.Name}」關聯：{trimmedReason}", pred, pred);
    SaveScheduleRevision(db, successorId, actor, at, "unlink-dependency", $"移除前置項目「{pred.Name}」：{trimmedReason}", succ, succ);

    AdvanceProjectVersion(db, item);
    tx.Commit();
    return Results.Ok(new { projectVersion = item.Version + 1 });
}
static IResult RemoveExternalLink(HttpContext ctx, Store store, string itemId, string depId, string? scheduleEntryId, string? reason, string? token, int? baseProjectVersion)
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item)) return Results.StatusCode(403);

    var conflict = ScheduleWriteConflict(db, item, Current(ctx), new ScheduleRequest(null, null, null, null, null, null, null, null, null, null, null, null, null, token, baseProjectVersion, null, null, null));
    if (conflict is not null) return conflict;

    if (string.IsNullOrWhiteSpace(scheduleEntryId))
        return Results.BadRequest(new { error = "schedule entry required" });
    if (string.IsNullOrWhiteSpace(reason))
        return Results.BadRequest(new { error = "reason required" });

    using var depRow = Store.Sql(db, "SELECT project_id, description, supplier FROM project_external_dependencies WHERE id=$id", ("$id", depId)).ExecuteReader();
    if (!depRow.Read()) return Results.NotFound();
    var depProjectId = depRow.GetString(0);
    var depDesc = depRow.GetString(1);
    var depSupp = depRow.GetString(2);
    depRow.Close();

    if (depProjectId != itemId) return Results.BadRequest(new { error = "cross project linking not allowed" });

    var entry = ScheduleEntry(db, scheduleEntryId);
    if (entry is null || entry.ProjectId != itemId) return Results.NotFound();

    var exists = Store.Sql(db, "SELECT 1 FROM project_external_dependency_links WHERE external_dependency_id=$d AND schedule_entry_id=$e",
        ("$d", depId), ("$e", scheduleEntryId)).ExecuteScalar() is not null;
    if (!exists) return Results.NotFound();

    Store.Sql(db, "DELETE FROM project_external_dependency_links WHERE external_dependency_id=$d AND schedule_entry_id=$e",
        ("$d", depId), ("$e", scheduleEntryId)).ExecuteNonQuery();

    var at = DateTimeOffset.UtcNow.ToString("O");
    var actor = Current(ctx).EmpNo;
    var trimmedReason = reason.Trim();

    SaveScheduleRevision(db, scheduleEntryId, actor, at, "unlink-external-dependency", $"解除跨部門相依事項「{depDesc}」關聯：{trimmedReason}", entry, entry);

    Store.Sql(db, "INSERT INTO project_external_dependency_history(external_dependency_id,actor,at,action,reason,schedule_entry_id,schedule_entry_name) VALUES($dep,$actor,$at,'unlink',$reason,$entry,$name)",
        ("$dep", depId), ("$actor", actor), ("$at", at), ("$reason", trimmedReason), ("$entry", scheduleEntryId), ("$name", entry.Name)).ExecuteNonQuery();

    AdvanceProjectVersion(db, item);
    tx.Commit();
    return Results.Ok(new { projectVersion = item.Version + 1 });
}
static string ExtractEcimSummary(string payload, string fallbackWorkId)
{
    try
    {
        using var doc = System.Text.Json.JsonDocument.Parse(payload);
        var root = doc.RootElement;
        foreach (var prop in new[] { "summary", "title", "content", "description", "workName" })
        {
            if (root.TryGetProperty(prop, out var val) && !string.IsNullOrWhiteSpace(val.GetString()))
                return val.GetString()!;
        }
    }
    catch { }
    return fallbackWorkId;
}
static List<ScheduleEvidenceView> GetScheduleEvidenceLinks(SqliteConnection db, string entryId)
{
    var list = new List<ScheduleEvidenceView>();
    using var rows = Store.Sql(db, """
        SELECT id, schedule_entry_id, work_id, section, summary, period_from, period_to, initial_payload, latest_payload, created_by, created_at, updated_at, reason
        FROM project_schedule_evidence_links
        WHERE schedule_entry_id=$entry
        ORDER BY rowid
        """, ("$entry", entryId)).ExecuteReader();
    while (rows.Read())
    {
        var initPayload = rows.GetString(7);
        var latestPayload = rows.GetString(8);
        list.Add(new ScheduleEvidenceView(
            rows.GetString(0),
            rows.GetString(1),
            rows.GetString(2),
            NullableString(rows, 3),
            rows.GetString(4),
            NullableString(rows, 5),
            NullableString(rows, 6),
            initPayload,
            latestPayload,
            initPayload != latestPayload,
            rows.GetString(9),
            rows.GetString(10),
            rows.GetString(11),
            rows.GetString(12)
        ));
    }
    return list;
}
static IResult RemoveEvidenceLink(HttpContext ctx, Store store, string itemId, string entryId, string linkId, string? reason, string? token, int? baseProjectVersion)
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item)) return Results.StatusCode(403);
    var entry = ScheduleEntry(db, entryId);
    if (entry is null || entry.ProjectId != itemId) return Results.NotFound();
    if (string.IsNullOrWhiteSpace(reason)) return Results.BadRequest(new { error = "reason required" });

    var conflict = ScheduleWriteConflict(db, item, Current(ctx), new ScheduleRequest(null, null, null, null, null, null, null, null, null, null, null, null, null, token, baseProjectVersion, null, null, null));
    if (conflict is not null) return conflict;

    using var existing = Store.Sql(db, "SELECT work_id, summary FROM project_schedule_evidence_links WHERE id=$id AND schedule_entry_id=$entry", ("$id", linkId), ("$entry", entryId)).ExecuteReader();
    if (!existing.Read()) return Results.NotFound();
    var unlinkedWorkId = existing.GetString(0);
    var unlinkedSummary = existing.GetString(1);
    existing.Close();

    var beforeEntry = ScheduleEntry(db, entryId)!;
    var at = DateTimeOffset.UtcNow.ToString("O");
    var actor = Current(ctx).EmpNo;
    var trimmedReason = reason.Trim();

    Store.Sql(db, "DELETE FROM project_schedule_evidence_links WHERE id=$id", ("$id", linkId)).ExecuteNonQuery();
    var afterEntry = ScheduleEntry(db, entryId)!;

    SaveScheduleRevision(db, entryId, actor, at, "unlink-evidence", $"移除 eCIM 證據「{unlinkedWorkId}（{unlinkedSummary}）」：{trimmedReason}", beforeEntry, afterEntry);
    AdvanceProjectVersion(db, item);
    tx.Commit();
    return Results.Ok(new { unlinkedId = linkId, projectVersion = item.Version + 1 });
}
static List<ScheduleRevisionView> GetScheduleRevisions(SqliteConnection db, string entryId)
{
    using var rows = Store.Sql(db, "SELECT actor,at,action,reason,before_state,after_state FROM project_schedule_revisions WHERE entry_id=$id ORDER BY id", ("$id", entryId)).ExecuteReader();
    var history = new List<ScheduleRevisionView>();
    while (rows.Read())
    {
        history.Add(new ScheduleRevisionView(
            rows.GetString(0),
            rows.GetString(1),
            rows.GetString(2),
            NullableString(rows, 3),
            rows.IsDBNull(4) ? null : System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(rows.GetString(4)),
            System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(rows.GetString(5))
        ));
    }
    return history;
}
static List<ExternalDependencyView> GetExternalDependencies(SqliteConnection db, string itemId)
{
    var list = new List<ExternalDependencyView>();
    using (var rows = Store.Sql(db, "SELECT id,project_id,description,supplier,due_date,status,created_by,created_at,updated_at FROM project_external_dependencies WHERE project_id=$project ORDER BY rowid", ("$project", itemId)).ExecuteReader())
    {
        while (rows.Read())
        {
            list.Add(new ExternalDependencyView(
                rows.GetString(0), rows.GetString(1), rows.GetString(2), rows.GetString(3), rows.GetString(4), rows.GetString(5), rows.GetString(6), rows.GetString(7), rows.GetString(8), [], []));
        }
    }

    var dict = list.ToDictionary(x => x.Id);

    using (var linkRows = Store.Sql(db, """
        SELECT l.external_dependency_id, e.id, e.name, e.kind
        FROM project_external_dependency_links l
        JOIN project_schedule_entries e ON e.id=l.schedule_entry_id
        WHERE l.project_id=$project
        ORDER BY e.rowid
        """, ("$project", itemId)).ExecuteReader())
    {
        while (linkRows.Read())
        {
            var depId = linkRows.GetString(0);
            if (dict.TryGetValue(depId, out var dep))
            {
                dep.LinkedScheduleEntries.Add(new ExternalDependencyLinkRef(linkRows.GetString(1), linkRows.GetString(2), linkRows.GetString(3)));
            }
        }
    }

    using (var histRows = Store.Sql(db, """
        SELECT external_dependency_id, actor, at, action, reason, schedule_entry_id, schedule_entry_name
        FROM project_external_dependency_history
        WHERE external_dependency_id IN (SELECT id FROM project_external_dependencies WHERE project_id=$project)
        ORDER BY id
        """, ("$project", itemId)).ExecuteReader())
    {
        while (histRows.Read())
        {
            var depId = histRows.GetString(0);
            if (dict.TryGetValue(depId, out var dep))
            {
                dep.History.Add(new ExternalDependencyHistoryEntry(
                    histRows.GetString(1), histRows.GetString(2), histRows.GetString(3),
                    NullableString(histRows, 4), NullableString(histRows, 5), NullableString(histRows, 6)));
            }
        }
    }

    return list;
}
static List<ScheduleEntry> ScheduleEntries(SqliteConnection db, string itemId, bool includeHistory = false)
{
    using var rows = Store.Sql(db, "SELECT id,project_id,kind,name,baseline_start,baseline_end,forecast_start,forecast_end,actual_start,actual_end,version,state,owner,phase_id,baseline_date,forecast_date,actual_date,continuity_id FROM project_schedule_entries WHERE project_id=$project ORDER BY rowid", ("$project", itemId)).ExecuteReader();
    var rawEntries = new List<ScheduleEntry>();
    while (rows.Read())
        rawEntries.Add(new ScheduleEntry(rows.GetString(0), rows.GetString(1), rows.GetString(2), rows.GetString(3), NullableString(rows, 4), NullableString(rows, 5), NullableString(rows, 6), NullableString(rows, 7), NullableString(rows, 8), NullableString(rows, 9), rows.GetInt32(10), rows.GetString(11), NullableString(rows, 12), NullableString(rows, 13), null, NullableString(rows, 14), NullableString(rows, 15), NullableString(rows, 16), null, null, null, null, null, NullableString(rows, 17) ?? rows.GetString(0)));
    rows.Close();

    var links = new List<(string PredecessorId, string SuccessorId)>();
    using (var depRows = Store.Sql(db, "SELECT predecessor_id, successor_id FROM project_schedule_dependencies WHERE project_id=$project", ("$project", itemId)).ExecuteReader())
    {
        while (depRows.Read()) links.Add((depRows.GetString(0), depRows.GetString(1)));
    }

    var entryDict = rawEntries.ToDictionary(e => e.Id);
    var predMap = new Dictionary<string, List<DependencyRef>>();
    var succMap = new Dictionary<string, List<DependencyRef>>();
    var warningMap = new Dictionary<string, List<DependencyWarning>>();

    foreach (var (pId, sId) in links)
    {
        if (!entryDict.TryGetValue(pId, out var p) || !entryDict.TryGetValue(sId, out var s)) continue;

        if (!predMap.TryGetValue(sId, out var pList)) predMap[sId] = pList = [];
        pList.Add(new DependencyRef(p.Id, p.Name, p.Kind));

        if (!succMap.TryGetValue(pId, out var sList)) succMap[pId] = sList = [];
        sList.Add(new DependencyRef(s.Id, s.Name, s.Kind));

        if (!warningMap.TryGetValue(sId, out var wList)) warningMap[sId] = wList = [];

        string? pFinish = p.Kind == "milestone" ? (p.ActualDate ?? p.ForecastDate ?? p.BaselineDate) : (p.ActualEnd ?? p.ForecastEnd ?? p.BaselineEnd);
        string? pActual = p.Kind == "milestone" ? p.ActualDate : p.ActualEnd;
        bool pCompleted = p.Kind == "milestone" ? (p.ActualDate != null || p.State == "achieved") : (p.ActualEnd != null || p.State == "completed");

        string? sStart = s.Kind == "milestone" ? (s.ActualDate ?? s.ForecastDate ?? s.BaselineDate) : (s.ActualStart ?? s.ForecastStart ?? s.BaselineStart);
        string? sActual = s.Kind == "milestone" ? s.ActualDate : s.ActualStart;
        bool sStarted = s.Kind == "milestone" ? (s.ActualDate != null || s.State == "achieved") : (s.ActualStart != null || s.State is "in-progress" or "completed");

        if (sStarted && !pCompleted)
        {
            wList.Add(new DependencyWarning("active-warning", $"即時警示：前置項目「{p.Name}」尚未完成，後續項目已搶先開始", p.Id, p.Name));
        }

        if (pFinish != null && sStart != null && string.Compare(pFinish, sStart, StringComparison.Ordinal) > 0)
        {
            var isHistorical = sActual != null || (pActual != null && sStarted);
            var msg = isHistorical
                ? $"順序衝突（歷史搶先開始）：前置項目「{p.Name}」完成日 ({pFinish}) 晚於本項開始日 ({sStart})"
                : $"順序衝突：前置項目「{p.Name}」預計完成日 ({pFinish}) 晚於本項預計開始日 ({sStart})";
            wList.Add(new DependencyWarning("conflict", msg, p.Id, p.Name));
        }
    }

    var extNoticeMap = new Dictionary<string, List<ExternalDeliveryNotice>>();
    var today = DateTime.UtcNow.ToString("yyyy-MM-dd");
    using (var extRows = Store.Sql(db, """
        SELECT l.schedule_entry_id, d.id, d.description, d.supplier, d.due_date, d.status
        FROM project_external_dependency_links l
        JOIN project_external_dependencies d ON d.id=l.external_dependency_id
        WHERE l.project_id=$project
        ORDER BY d.rowid
        """, ("$project", itemId)).ExecuteReader())
    {
        while (extRows.Read())
        {
            var schedId = extRows.GetString(0);
            var depId = extRows.GetString(1);
            var desc = extRows.GetString(2);
            var supplier = extRows.GetString(3);
            var dueDate = extRows.GetString(4);
            var status = extRows.GetString(5);

            if (!extNoticeMap.TryGetValue(schedId, out var notices)) extNoticeMap[schedId] = notices = [];

            var isDelivered = status == "delivered";
            var isOverdue = !isDelivered && string.Compare(dueDate, today, StringComparison.Ordinal) < 0;

            if (!isDelivered)
            {
                var msg = isOverdue
                    ? $"外部交付提醒（已逾期）：由「{supplier}」承諾之「{desc}」已逾期（到期日：{dueDate}）"
                    : $"外部交付提醒：由「{supplier}」承諾之「{desc}」尚未交付（預計到期日：{dueDate}）";
                notices.Add(new ExternalDeliveryNotice(depId, desc, supplier, dueDate, status, isOverdue, msg));
            }
        }
    }

    var evidenceMap = new Dictionary<string, List<ScheduleEvidenceView>>();
    using (var evRows = Store.Sql(db, """
        SELECT id, schedule_entry_id, work_id, section, summary, period_from, period_to, initial_payload, latest_payload, created_by, created_at, updated_at, reason
        FROM project_schedule_evidence_links
        WHERE project_id=$project
        ORDER BY rowid
        """, ("$project", itemId)).ExecuteReader())
    {
        while (evRows.Read())
        {
            var schedId = evRows.GetString(1);
            if (!evidenceMap.TryGetValue(schedId, out var evList)) evidenceMap[schedId] = evList = [];
            var initPayload = evRows.GetString(7);
            var latestPayload = evRows.GetString(8);
            evList.Add(new ScheduleEvidenceView(
                evRows.GetString(0),
                schedId,
                evRows.GetString(2),
                NullableString(evRows, 3),
                evRows.GetString(4),
                NullableString(evRows, 5),
                NullableString(evRows, 6),
                initPayload,
                latestPayload,
                initPayload != latestPayload,
                evRows.GetString(9),
                evRows.GetString(10),
                evRows.GetString(11),
                evRows.GetString(12)
            ));
        }
    }

    return rawEntries.Select(entry => entry with {
        UnfinishedTasks = entry.Kind == "phase"
            ? rawEntries.Where(task => task.Kind == "task" && task.PhaseId == entry.Id && task.State != "completed" && task.State != "cancelled").Select(task => task.Name).ToList()
            : null,
        Predecessors = predMap.GetValueOrDefault(entry.Id) ?? [],
        Successors = succMap.GetValueOrDefault(entry.Id) ?? [],
        Warnings = warningMap.GetValueOrDefault(entry.Id) ?? [],
        ExternalNotices = extNoticeMap.GetValueOrDefault(entry.Id) ?? [],
        EvidenceLinks = evidenceMap.GetValueOrDefault(entry.Id) ?? [],
        History = includeHistory ? GetScheduleRevisions(db, entry.Id) : null
    }).ToList();
}
static ScheduleEntry? ScheduleEntry(SqliteConnection db, string entryId)
{
    using var rows = Store.Sql(db, "SELECT id,project_id,kind,name,baseline_start,baseline_end,forecast_start,forecast_end,actual_start,actual_end,version,state,owner,phase_id,baseline_date,forecast_date,actual_date,continuity_id FROM project_schedule_entries WHERE id=$id", ("$id", entryId)).ExecuteReader();
    if (!rows.Read()) return null;
    var baseEntry = new ScheduleEntry(rows.GetString(0), rows.GetString(1), rows.GetString(2), rows.GetString(3), NullableString(rows, 4), NullableString(rows, 5), NullableString(rows, 6), NullableString(rows, 7), NullableString(rows, 8), NullableString(rows, 9), rows.GetInt32(10), rows.GetString(11), NullableString(rows, 12), NullableString(rows, 13), null, NullableString(rows, 14), NullableString(rows, 15), NullableString(rows, 16), null, null, null, null, null, NullableString(rows, 17) ?? rows.GetString(0));
    rows.Close();
    return baseEntry with { EvidenceLinks = GetScheduleEvidenceLinks(db, entryId) };
}
static ReportSnapshot Snapshot(SqliteConnection db, string reportId, IConfiguration config)
{
    var meetingDate = (string)Store.Sql(db, "SELECT meeting_date FROM reports WHERE id=$id", ("$id", reportId)).ExecuteScalar()!;
    var items = new List<PublishedItem>();
    using (var rows = Store.Sql(db, "SELECT id,continuity_id,section,owner_section,title,content,details,status,version FROM items WHERE report_id=$report AND version>0 ORDER BY rowid", ("$report", reportId)).ExecuteReader())
    {
        while (rows.Read()) items.Add(new PublishedItem(rows.GetString(0), rows.GetString(1), rows.GetString(2), rows.GetString(3), rows.GetString(4), rows.GetString(5), rows.GetString(7), rows.GetInt32(8), rows.GetString(6)));
    }
    items = items.Select(item => {
        if (item.Section == "projects")
        {
            return item with {
                Schedule = ScheduleEntries(db, item.Id, includeHistory: true),
                ExternalDependencies = GetExternalDependencies(db, item.Id)
            };
        }
        return item with { Schedule = ScheduleEntries(db, item.Id) };
    }).ToList();
    var sections = EcimMembers(config).Select(member => member.Section).ToHashSet();
    using (var sectionRows = Store.Sql(db, "SELECT DISTINCT section FROM users WHERE role='Head' AND section IS NOT NULL ORDER BY section").ExecuteReader())
        while (sectionRows.Read()) sections.Add(sectionRows.GetString(0));
    using (var importSections = Store.Sql(db, "SELECT DISTINCT section FROM ecim_import_runs WHERE report_id=$report", ("$report", reportId)).ExecuteReader())
        while (importSections.Read()) sections.Add(importSections.GetString(0));
    var sourceStatus = new List<SourceStatus>();
    foreach (var section in sections)
    {
        using var latest = Store.Sql(db, "SELECT status,period_from,period_to,finished_at FROM ecim_import_runs WHERE report_id=$report AND section=$section ORDER BY started_at DESC LIMIT 1", ("$report", reportId), ("$section", section)).ExecuteReader();
        sourceStatus.Add(latest.Read()
            ? new SourceStatus(section, latest.GetString(0), NullableString(latest, 1), NullableString(latest, 2), NullableString(latest, 3))
            : new SourceStatus(section, "not-connected", null, null, null));
    }
    return new ReportSnapshot(meetingDate, items, sourceStatus);
}
static ReportSnapshot? PreviousPublication(SqliteConnection db, string meetingDate)
{
    var serialized = Store.Sql(db, "SELECT p.snapshot FROM publications p JOIN reports r ON r.id=p.report_id WHERE r.meeting_date < $date ORDER BY r.meeting_date DESC,p.version DESC LIMIT 1", ("$date", meetingDate)).ExecuteScalar() as string;
    return serialized is null ? null : System.Text.Json.JsonSerializer.Deserialize<ReportSnapshot>(serialized);
}
static IResult Conflict(SqliteConnection db, string id, string actor, string error, Lease? lease)
{
    var item = GetItem(db, id)!;
    using var rows = Store.Sql(db, "SELECT title,content,details,status,saved_at FROM drafts WHERE item_id=$id AND editor=$actor", ("$id", id), ("$actor", actor)).ExecuteReader();
    object? draft = rows.Read() ? new { title = rows.GetString(0), content = rows.GetString(1), details = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(rows.GetString(2)), status = rows.GetString(3), savedAt = rows.GetString(4) } : null;
    return Results.Conflict(new { error, latest = new { item.Title, item.Content, details = System.Text.Json.JsonSerializer.Deserialize<System.Text.Json.JsonElement>(item.Details), item.Version }, draft, lease = LeaseObject(lease) });
}
static IResult ChangeLease(HttpContext ctx, Store store, IConfiguration config, string id, string token, bool release)
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, id);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (!CanEdit(user, item.OwnerSection)) return Results.StatusCode(403);
    var lease = GetLease(db, id);
    if (lease is null || lease.Holder != user.EmpNo || lease.ExpiresAt <= DateTimeOffset.UtcNow || !Matches(token, lease.TokenHash)) return Conflict(db, id, user.EmpNo, "stale lease", lease);
    if (release) Store.Sql(db, "DELETE FROM leases WHERE item_id=$id", ("$id", id)).ExecuteNonQuery();
    else Store.Sql(db, "UPDATE leases SET expires_at=$at WHERE item_id=$id", ("$at", DateTimeOffset.UtcNow.AddSeconds(LeaseSeconds(config)).ToString("O")), ("$id", id)).ExecuteNonQuery();
    tx.Commit();
    return Results.NoContent();
}

record User(string EmpNo, string Name, string Role, string? Section, bool ReaderAccess);
record Item(string Id, string ContinuityId, string Section, string OwnerSection, string Title, string Content, string Details, string Status, int Version);
record Lease(string Holder, string TokenHash, DateTimeOffset ExpiresAt, int BaseVersion);
record CreateReport(string MeetingDate);
record CreateItem(string Section, string Title, string? OwnerSection);
record ProjectParticipantRequest(string? Section);
record ProjectWorkRequest(string? Section, string? Work, string? ScheduleProposal, int BaseVersion, string? ScheduleEntryId = null, int? ProgressPercent = null, string? ProposedStart = null, string? ProposedEnd = null, string? SourceOrigin = null);
record ProjectProposalRequest(string? ScheduleEntryId, string? WorkDescription, int? ProgressPercent = null, string? ProposedStart = null, string? ProposedEnd = null, string? ProposedDate = null, string? ProposedState = null, string? SourceOrigin = null);
record ProposalDecisionRequest(string? Reason, string? Token, int? BaseProjectVersion, int? BaseEntryVersion = null);
record ProjectProposalView(string Id, string ProjectId, string ScheduleEntryId, string ScheduleEntryName, string ScheduleEntryKind, string? ScheduleEntryOwner, int? ProgressPercent, string WorkDescription, string? ProposedStart, string? ProposedEnd, string? ProposedDate, string? ProposedState, string? SourceOrigin, string Status, string CreatedBy, string CreatedByName, string CreatedAt, string? DecidedBy, string? DecidedByName, string? DecidedAt, string? DecisionReason, string? CurrentBaselineStart, string? CurrentBaselineEnd, string? CurrentForecastStart, string? CurrentForecastEnd, string? CurrentBaselineDate, string? CurrentForecastDate, string? CurrentState);
record SyncMemberResult(string UserId, string Status, int WorkCount, string? LastSuccessAt, string? Error);
record ScheduleRequest(string? Kind, string? Name, string? BaselineStart, string? BaselineEnd, string? ForecastStart, string? ForecastEnd, string? ActualStart, string? ActualEnd, string? BaselineChangeReason, int? BaseVersion, string? State, string? Reason, string? Action, string? Token, int? BaseProjectVersion, string? Owner, string? PhaseId, bool? AcknowledgeIncompleteTasks, string? TargetDate = null, string? BaselineDate = null, string? ForecastDate = null, string? ActualDate = null);
record DependencyRef(string Id, string Name, string Kind);
record DependencyWarning(string Type, string Message, string PredecessorId, string PredecessorName);
record ScheduleDependencyRequest(string? PredecessorId, string? SuccessorId, string? Reason, string? Token, int? BaseProjectVersion);
record AccessUserRequest(string EmpNo, string Name, string Role, string? Section, bool? ReaderAccess);
record PublicationRequest(string? RequestId);
record ExternalDeliveryNotice(string DependencyId, string Description, string Supplier, string DueDate, string Status, bool IsOverdue, string Message);
record ExternalDependencyLinkRef(string ScheduleEntryId, string ScheduleEntryName, string ScheduleEntryKind);
record ExternalDependencyHistoryEntry(string Actor, string At, string Action, string? Reason, string? ScheduleEntryId, string? ScheduleEntryName);
record ExternalDependencyView(string Id, string ProjectId, string Description, string Supplier, string DueDate, string Status, string CreatedBy, string CreatedAt, string UpdatedAt, List<ExternalDependencyLinkRef> LinkedScheduleEntries, List<ExternalDependencyHistoryEntry> History);
record ExternalDependencyRequest(string? Description, string? Supplier, string? DueDate, string? Status, string? Reason, string? Token, int? BaseProjectVersion);
record ExternalDependencyLinkRequest(string? ScheduleEntryId, string? Reason, string? Token, int? BaseProjectVersion);
record ScheduleRevisionView(string Actor, string At, string Action, string? Reason, System.Text.Json.JsonElement? Before, System.Text.Json.JsonElement? After);
record ScheduleEvidenceLinkRequest(string? WorkId, string? Reason, string? Token, int? BaseProjectVersion, string? Summary = null, string? Section = null);
record ScheduleEvidenceUnlinkRequest(string? Reason, string? Token, int? BaseProjectVersion);
record ScheduleEvidenceView(string Id, string ScheduleEntryId, string WorkId, string? Section, string Summary, string? PeriodFrom, string? PeriodTo, string InitialPayload, string LatestPayload, bool SourceChanged, string CreatedBy, string CreatedAt, string UpdatedAt, string Reason);
record EcimEvidenceCandidateSource(string WorkId, string Section, string? PeriodFrom, string? PeriodTo, string Summary, string Payload);
record ScheduleEntry(string Id, string ProjectId, string Kind, string Name, string? BaselineStart, string? BaselineEnd, string? ForecastStart, string? ForecastEnd, string? ActualStart, string? ActualEnd, int Version, string State = "open", string? Owner = null, string? PhaseId = null, List<string>? UnfinishedTasks = null, string? BaselineDate = null, string? ForecastDate = null, string? ActualDate = null, List<DependencyRef>? Predecessors = null, List<DependencyRef>? Successors = null, List<DependencyWarning>? Warnings = null, List<ExternalDeliveryNotice>? ExternalNotices = null, List<ScheduleRevisionView>? History = null, string? ContinuityId = null, List<ScheduleEvidenceView>? EvidenceLinks = null);
record PublishedItem(string Id, string ContinuityId, string Section, string OwnerSection, string Title, string Content, string Status, int Version, string Details = "{}", List<ScheduleEntry>? Schedule = null, List<ExternalDependencyView>? ExternalDependencies = null);
record SourceStatus(string Section, string Status, string? PeriodFrom, string? PeriodTo, string? FinishedAt);
record FieldOrigin(string? LastSourceValue, string LatestSourceValue, string ReportValue, bool HumanOverride);
record CandidateDecisionRequest(string? Action, string? TargetItemId);
record ReportSnapshot(string MeetingDate, List<PublishedItem> Items, List<SourceStatus>? SourceStatus = null);
record DraftRequest(string Title, string Content, System.Text.Json.JsonElement? Details, string? Status);
record TokenRequest(string Token);
record CommitRequest(string Token, int BaseVersion, string? Status);
record TakeoverRequest(string Reason);
static class ReportSections
{
    public static readonly string[] All = ["summary", "projects", "operations", "personnel", "technology", "appendix"];
}

