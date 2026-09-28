using System.Security.Cryptography;
using System.Text;
using Microsoft.Data.Sqlite;
using Microsoft.Extensions.FileProviders;
using Microsoft.AspNetCore.Mvc;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Services.AddSingleton<Store>();
builder.Services.AddHttpClient<JwtVerifier>();
builder.Services.AddHttpClient<EcimClient>();
var app = builder.Build();
app.Services.GetRequiredService<Store>().Initialize();
var webRoot = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "../web/dist/weekly-report-web/browser"));
if (Directory.Exists(webRoot))
{
    var files = new PhysicalFileProvider(webRoot);
    app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = files });
    app.UseStaticFiles(new StaticFileOptions { FileProvider = files });
}

app.Use(async (context, next) =>
{
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
            foreach (var item in snapshot.Items.Where(item => item.Status != "closed"))
            {
                var carriedId = Guid.NewGuid().ToString();
                Store.Sql(db, "INSERT INTO items(id,report_id,continuity_id,section,owner_section,title,content,details,status,version,created_by) VALUES($id,$report,$continuity,$section,$owner,$title,$content,$details,$status,1,$actor)",
                    ("$id", carriedId), ("$report", newReportId), ("$continuity", item.ContinuityId), ("$section", item.Section), ("$owner", item.OwnerSection), ("$title", item.Title), ("$content", item.Content), ("$details", CarryDetails(item)), ("$status", item.Status), ("$actor", Current(ctx).EmpNo)).ExecuteNonQuery();
                foreach (var entry in item.Schedule ?? [])
                    Store.Sql(db, "INSERT INTO project_schedule_entries(id,project_id,kind,name,baseline_start,baseline_end,forecast_start,forecast_end,actual_start,actual_end,version,created_by,updated_at) VALUES($id,$project,$kind,$name,$baselineStart,$baselineEnd,$forecastStart,$forecastEnd,$actualStart,$actualEnd,$version,$actor,$at)",
                        ("$id", Guid.NewGuid().ToString()), ("$project", carriedId), ("$kind", entry.Kind), ("$name", entry.Name), ("$baselineStart", entry.BaselineStart), ("$baselineEnd", entry.BaselineEnd), ("$forecastStart", entry.ForecastStart), ("$forecastEnd", entry.ForecastEnd), ("$actualStart", entry.ActualStart), ("$actualEnd", entry.ActualEnd), ("$version", entry.Version), ("$actor", Current(ctx).EmpNo), ("$at", DateTimeOffset.UtcNow.ToString("O"))).ExecuteNonQuery();
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
    Store.Sql(db, "INSERT INTO audit(item_id,actor,at,action) VALUES($id,$actor,$at,'project-work')", ("$id", itemId), ("$actor", user.EmpNo), ("$at", at)).ExecuteNonQuery();
    tx.Commit();
    return Results.Ok(new { version = beforeVersion + 1 });
});
app.MapGet("/api/items/{itemId}/schedule", (HttpContext ctx, Store store, string itemId) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (item.Section != "projects" || !CanMaintainProject(user, item) && !IsProjectParticipant(db, itemId, user.Section)) return Results.StatusCode(403);
    return Results.Ok(ScheduleEntries(db, itemId));
});
app.MapPost("/api/items/{itemId}/schedule", (HttpContext ctx, Store store, string itemId, ScheduleRequest request) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item)) return Results.StatusCode(403);
    if (!ValidSchedule(request)) return Results.BadRequest();
    var id = Guid.NewGuid().ToString();
    var at = DateTimeOffset.UtcNow.ToString("O");
    Store.Sql(db, "INSERT INTO project_schedule_entries(id,project_id,kind,name,baseline_start,baseline_end,forecast_start,forecast_end,actual_start,actual_end,created_by,updated_at) VALUES($id,$project,$kind,$name,$baselineStart,$baselineEnd,$forecastStart,$forecastEnd,$actualStart,$actualEnd,$actor,$at)",
        ("$id", id), ("$project", itemId), ("$kind", request.Kind!), ("$name", request.Name!.Trim()), ("$baselineStart", request.BaselineStart), ("$baselineEnd", request.BaselineEnd), ("$forecastStart", request.ForecastStart), ("$forecastEnd", request.ForecastEnd), ("$actualStart", request.ActualStart), ("$actualEnd", request.ActualEnd), ("$actor", Current(ctx).EmpNo), ("$at", at)).ExecuteNonQuery();
    return Results.Created($"/api/items/{itemId}/schedule/{id}", new { id, version = 1 });
});
app.MapPut("/api/items/{itemId}/schedule/{entryId}", (HttpContext ctx, Store store, string itemId, string entryId, ScheduleRequest request) =>
{
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (item.Section != "projects" || !CanMaintainProject(Current(ctx), item)) return Results.StatusCode(403);
    if (!ValidSchedule(request)) return Results.BadRequest();
    var current = ScheduleEntry(db, entryId);
    if (current is null || current.ProjectId != itemId) return Results.NotFound();
    if (request.BaseVersion != current.Version) return Results.Conflict(new { error = "stale schedule version", latest = current });
    var baselineChanged = current.BaselineStart != request.BaselineStart || current.BaselineEnd != request.BaselineEnd;
    if (baselineChanged && string.IsNullOrWhiteSpace(request.BaselineChangeReason)) return Results.BadRequest(new { error = "baselineChangeReason required" });
    var at = DateTimeOffset.UtcNow.ToString("O");
    Store.Sql(db, "UPDATE project_schedule_entries SET kind=$kind,name=$name,baseline_start=$baselineStart,baseline_end=$baselineEnd,forecast_start=$forecastStart,forecast_end=$forecastEnd,actual_start=$actualStart,actual_end=$actualEnd,version=version+1,updated_at=$at WHERE id=$id AND version=$version",
        ("$kind", request.Kind!), ("$name", request.Name!.Trim()), ("$baselineStart", request.BaselineStart), ("$baselineEnd", request.BaselineEnd), ("$forecastStart", request.ForecastStart), ("$forecastEnd", request.ForecastEnd), ("$actualStart", request.ActualStart), ("$actualEnd", request.ActualEnd), ("$at", at), ("$id", entryId), ("$version", current.Version)).ExecuteNonQuery();
    if (baselineChanged)
        Store.Sql(db, "INSERT INTO project_baseline_history(entry_id,actor,at,before_baseline_start,before_baseline_end,after_baseline_start,after_baseline_end,reason) VALUES($entry,$actor,$at,$beforeStart,$beforeEnd,$afterStart,$afterEnd,$reason)",
            ("$entry", entryId), ("$actor", Current(ctx).EmpNo), ("$at", at), ("$beforeStart", current.BaselineStart), ("$beforeEnd", current.BaselineEnd), ("$afterStart", request.BaselineStart), ("$afterEnd", request.BaselineEnd), ("$reason", request.BaselineChangeReason!.Trim())).ExecuteNonQuery();
    tx.Commit();
    return Results.Ok(new { version = current.Version + 1 });
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

static User Current(HttpContext context) => (User)context.Items["user"]!;
static bool Editor(User user) => user.Role is "Guy" or "Head";
static List<EcimMember> EcimMembers(IConfiguration config) => config.GetSection("Ecim:Members").GetChildren()
    .Select(member => new EcimMember(member["Section"] ?? "", member["UserId"] ?? "", member["UpdateDateFrom"], member["UpdateDateTo"], member["TimeFrom"], member["TimeTo"], member["Division"], member["Dept"], member["TeamId"]))
    .Where(member => !string.IsNullOrWhiteSpace(member.Section) && !string.IsNullOrWhiteSpace(member.UserId)).ToList();
static bool CanReadPublication(User user) => user.Role == "Guy" || user.ReaderAccess;
static bool CanEdit(User user, string ownerSection) => user.Role == "Guy" || user.Role == "Head" && user.Section == ownerSection;
static bool CanMaintainProject(User user, Item item) => item.Section == "projects" && CanEdit(user, item.OwnerSection);
static bool IsProjectParticipant(SqliteConnection db, string itemId, string? section) => !string.IsNullOrWhiteSpace(section) && Store.Sql(db, "SELECT 1 FROM project_participants WHERE project_id=$project AND section=$section", ("$project", itemId), ("$section", section)).ExecuteScalar() is not null;
static bool ValidSection(SqliteConnection db, string? section) => !string.IsNullOrWhiteSpace(section) && Store.Sql(db, "SELECT 1 FROM users WHERE role='Head' AND section=$section", ("$section", section.Trim())).ExecuteScalar() is not null;
static bool Valid(string? title, string? content) => !string.IsNullOrWhiteSpace(title) && title.Length <= 200 && content is not null && content.Length <= 20000;
static bool ValidProjectWork(string? work, string? scheduleProposal) => !string.IsNullOrWhiteSpace(work) && work.Length <= 20000 && (scheduleProposal is null || scheduleProposal.Length <= 2000);
static bool ValidSchedule(ScheduleRequest request) => request.Kind is "phase" or "milestone" && !string.IsNullOrWhiteSpace(request.Name) && request.Name.Length <= 200 && (request.Kind == "phase" ? ValidDateRange(request.BaselineStart, request.BaselineEnd) && ValidDateRange(request.ForecastStart, request.ForecastEnd) && ValidDateRange(request.ActualStart, request.ActualEnd) : ValidMilestoneDates(request.BaselineStart, request.BaselineEnd) && ValidMilestoneDates(request.ForecastStart, request.ForecastEnd) && ValidMilestoneDates(request.ActualStart, request.ActualEnd));
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
static bool ValidMilestoneDates(string? start, string? end)
{
    if (start is null && end is null) return true;
    if (start is not null && !DateOnly.TryParseExact(start, "yyyy-MM-dd", out _)) return false;
    if (end is not null && !DateOnly.TryParseExact(end, "yyyy-MM-dd", out _)) return false;
    return start is null || end is null || string.CompareOrdinal(start, end) <= 0;
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
static List<ScheduleEntry> ScheduleEntries(SqliteConnection db, string itemId)
{
    using var rows = Store.Sql(db, "SELECT id,project_id,kind,name,baseline_start,baseline_end,forecast_start,forecast_end,actual_start,actual_end,version FROM project_schedule_entries WHERE project_id=$project ORDER BY rowid", ("$project", itemId)).ExecuteReader();
    var entries = new List<ScheduleEntry>();
    while (rows.Read()) entries.Add(new ScheduleEntry(rows.GetString(0), rows.GetString(1), rows.GetString(2), rows.GetString(3), NullableString(rows, 4), NullableString(rows, 5), NullableString(rows, 6), NullableString(rows, 7), NullableString(rows, 8), NullableString(rows, 9), rows.GetInt32(10)));
    return entries;
}
static ScheduleEntry? ScheduleEntry(SqliteConnection db, string entryId)
{
    using var rows = Store.Sql(db, "SELECT id,project_id,kind,name,baseline_start,baseline_end,forecast_start,forecast_end,actual_start,actual_end,version FROM project_schedule_entries WHERE id=$id", ("$id", entryId)).ExecuteReader();
    return rows.Read() ? new ScheduleEntry(rows.GetString(0), rows.GetString(1), rows.GetString(2), rows.GetString(3), NullableString(rows, 4), NullableString(rows, 5), NullableString(rows, 6), NullableString(rows, 7), NullableString(rows, 8), NullableString(rows, 9), rows.GetInt32(10)) : null;
}
static ReportSnapshot Snapshot(SqliteConnection db, string reportId, IConfiguration config)
{
    var meetingDate = (string)Store.Sql(db, "SELECT meeting_date FROM reports WHERE id=$id", ("$id", reportId)).ExecuteScalar()!;
    var items = new List<PublishedItem>();
    using (var rows = Store.Sql(db, "SELECT id,continuity_id,section,owner_section,title,content,details,status,version FROM items WHERE report_id=$report AND version>0 ORDER BY rowid", ("$report", reportId)).ExecuteReader())
    {
        while (rows.Read()) items.Add(new PublishedItem(rows.GetString(0), rows.GetString(1), rows.GetString(2), rows.GetString(3), rows.GetString(4), rows.GetString(5), rows.GetString(7), rows.GetInt32(8), rows.GetString(6)));
    }
    items = items.Select(item => item with { Schedule = ScheduleEntries(db, item.Id) }).ToList();
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
record ProjectWorkRequest(string? Section, string? Work, string? ScheduleProposal, int BaseVersion);
record SyncMemberResult(string UserId, string Status, int WorkCount, string? LastSuccessAt, string? Error);
record ScheduleRequest(string? Kind, string? Name, string? BaselineStart, string? BaselineEnd, string? ForecastStart, string? ForecastEnd, string? ActualStart, string? ActualEnd, string? BaselineChangeReason, int? BaseVersion);
record AccessUserRequest(string EmpNo, string Name, string Role, string? Section, bool? ReaderAccess);
record PublicationRequest(string? RequestId);
record ScheduleEntry(string Id, string ProjectId, string Kind, string Name, string? BaselineStart, string? BaselineEnd, string? ForecastStart, string? ForecastEnd, string? ActualStart, string? ActualEnd, int Version);
record PublishedItem(string Id, string ContinuityId, string Section, string OwnerSection, string Title, string Content, string Status, int Version, string Details = "{}", List<ScheduleEntry>? Schedule = null);
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

