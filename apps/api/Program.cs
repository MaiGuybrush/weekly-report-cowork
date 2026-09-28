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
    using var cmd = Store.Sql(db, "SELECT emp_no,name,role,section FROM users WHERE emp_no=$id COLLATE NOCASE", ("$id", empNo));
    using var row = cmd.ExecuteReader();
    if (!row.Read()) { context.Response.StatusCode = 403; return; }
    context.Items["user"] = new User(row.GetString(0), row.GetString(1), row.GetString(2), row.IsDBNull(3) ? null : row.GetString(3));
    await next();
});

app.MapGet("/api/me", (HttpContext ctx) => Results.Ok(Current(ctx)));
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
    Store.Sql(db, "INSERT INTO reports(id,meeting_date,created_by) VALUES($id,$date,$actor) ON CONFLICT(meeting_date) DO NOTHING",
        ("$id", Guid.NewGuid().ToString()), ("$date", request.MeetingDate), ("$actor", Current(ctx).EmpNo)).ExecuteNonQuery();
    var id = (string)Store.Sql(db, "SELECT id FROM reports WHERE meeting_date=$date", ("$date", request.MeetingDate)).ExecuteScalar()!;
    tx.Commit();
    return Results.Ok(new { id, request.MeetingDate, sections = ReportSections.All });
});
app.MapGet("/api/reports/{reportId}", (HttpContext ctx, Store store, string reportId) =>
{
    var user = Current(ctx);
    if (!Editor(user)) return Results.StatusCode(403);
    using var db = store.Open();
    var date = Store.Sql(db, "SELECT meeting_date FROM reports WHERE id=$id", ("$id", reportId)).ExecuteScalar() as string;
    if (date is null) return Results.NotFound();
    using var rows = Store.Sql(db, "SELECT i.id,i.section,i.owner_section,CASE WHEN i.version=0 THEN d.title ELSE i.title END,i.content,i.version,l.holder,l.expires_at FROM items i LEFT JOIN leases l ON l.item_id=i.id LEFT JOIN drafts d ON d.item_id=i.id AND d.editor=$actor WHERE i.report_id=$id AND (i.version>0 OR i.created_by=$actor) ORDER BY i.rowid", ("$id", reportId), ("$actor", user.EmpNo)).ExecuteReader();
    var items = new List<object>();
    while (rows.Read())
    {
        var section = rows.GetString(1);
        var ownerSection = rows.GetString(2);
        if (!CanEdit(user, ownerSection)) continue;
        items.Add(new { id = rows.GetString(0), section, ownerSection, title = rows.GetString(3), content = rows.GetString(4), version = rows.GetInt32(5), lease = LeaseView(rows) });
    }
    return Results.Ok(new { id = reportId, meetingDate = date, sections = ReportSections.All, items });
});
app.MapPost("/api/reports/{reportId}/items", (HttpContext ctx, Store store, string reportId, CreateItem request) =>
{
    var user = Current(ctx);
    var ownerSection = user.Role == "Guy" ? request.OwnerSection ?? "cross" : user.Section;
    if (!Editor(user) || user.Role == "Head" && request.OwnerSection is not null && request.OwnerSection != user.Section) return Results.StatusCode(403);
    if (string.IsNullOrWhiteSpace(request.Title) || request.Title.Length > 200 || !ReportSections.All.Contains(request.Section)) return Results.BadRequest();
    if (string.IsNullOrWhiteSpace(ownerSection)) return Results.BadRequest();
    using var db = store.Open();
    using var tx = db.BeginTransaction();
    if (Store.Sql(db, "SELECT 1 FROM reports WHERE id=$id", ("$id", reportId)).ExecuteScalar() is null) return Results.NotFound();
    var id = Guid.NewGuid().ToString();
    Store.Sql(db, "INSERT INTO items(id,report_id,section,owner_section,title,created_by) VALUES($id,$report,$section,$owner,'',$actor)",
        ("$id", id), ("$report", reportId), ("$section", request.Section), ("$owner", ownerSection), ("$actor", user.EmpNo)).ExecuteNonQuery();
    Store.Sql(db, "INSERT INTO drafts(item_id,editor,title,content,saved_at) VALUES($id,$actor,$title,'',$at)",
        ("$id", id), ("$actor", user.EmpNo), ("$title", request.Title.Trim()), ("$at", DateTimeOffset.UtcNow.ToString("O"))).ExecuteNonQuery();
    tx.Commit();
    return Results.Created($"/api/items/{id}", new { id, version = 0 });
});
app.MapGet("/api/items/{itemId}", (HttpContext ctx, Store store, string itemId) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    if (!CanEdit(Current(ctx), item.OwnerSection)) return Results.StatusCode(403);
    if (item.Version == 0 && Current(ctx).EmpNo != Creator(db, itemId)) return Results.NotFound();
    return Results.Ok(new { item.Id, item.Section, item.OwnerSection, item.Title, item.Content, item.Version, lease = LeaseObject(GetLease(db, itemId)) });
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
    using var rows = Store.Sql(db, "SELECT title,content,saved_at FROM drafts WHERE item_id=$id AND editor=$actor", ("$id", itemId), ("$actor", user.EmpNo)).ExecuteReader();
    return rows.Read() ? Results.Ok(new { title = rows.GetString(0), content = rows.GetString(1), savedAt = rows.GetString(2) }) : Results.NotFound();
});
app.MapPut("/api/items/{itemId}/private-draft", (HttpContext ctx, Store store, string itemId, DraftRequest request) =>
{
    using var db = store.Open();
    var item = GetItem(db, itemId);
    if (item is null) return Results.NotFound();
    var user = Current(ctx);
    if (!CanEdit(user, item.OwnerSection)) return Results.StatusCode(403);
    if (!Valid(request.Title, request.Content)) return Results.BadRequest();
    Store.Sql(db, "INSERT INTO drafts(item_id,editor,title,content,saved_at) VALUES($id,$actor,$title,$content,$at) ON CONFLICT(item_id,editor) DO UPDATE SET title=excluded.title,content=excluded.content,saved_at=excluded.saved_at",
        ("$id", itemId), ("$actor", user.EmpNo), ("$title", request.Title.Trim()), ("$content", request.Content), ("$at", DateTimeOffset.UtcNow.ToString("O"))).ExecuteNonQuery();
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
    using var draftRows = Store.Sql(db, "SELECT title,content FROM drafts WHERE item_id=$id AND editor=$actor", ("$id", itemId), ("$actor", user.EmpNo)).ExecuteReader();
    if (!draftRows.Read()) return Results.BadRequest(new { error = "private draft required" });
    var title = draftRows.GetString(0);
    var content = draftRows.GetString(1);
    draftRows.Close();
    if (!Valid(title, content)) return Results.BadRequest();
    Store.Sql(db, "UPDATE items SET title=$title,content=$content,version=version+1 WHERE id=$id AND version=$version", ("$title", title), ("$content", content), ("$id", itemId), ("$version", item.Version)).ExecuteNonQuery();
    Store.Sql(db, "INSERT INTO revisions(item_id,actor,at,before_version,after_version,before_title,after_title,before_content,after_content) VALUES($id,$actor,$at,$before,$after,$oldTitle,$newTitle,$oldContent,$newContent)",
        ("$id", itemId), ("$actor", user.EmpNo), ("$at", DateTimeOffset.UtcNow.ToString("O")), ("$before", item.Version), ("$after", item.Version + 1), ("$oldTitle", item.Title), ("$newTitle", title), ("$oldContent", item.Content), ("$newContent", content)).ExecuteNonQuery();
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
    using (var rows = Store.Sql(db, "SELECT actor,at,before_version,after_version,before_title,after_title,before_content,after_content FROM revisions WHERE item_id=$id ORDER BY id", ("$id", itemId)).ExecuteReader())
        while (rows.Read()) history.Add(new { action = "commit", actor = rows.GetString(0), at = rows.GetString(1), beforeVersion = rows.GetInt32(2), afterVersion = rows.GetInt32(3), beforeTitle = rows.GetString(4), afterTitle = rows.GetString(5), beforeContent = rows.GetString(6), afterContent = rows.GetString(7) });
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
static bool CanEdit(User user, string ownerSection) => user.Role == "Guy" || user.Role == "Head" && user.Section == ownerSection;
static bool Valid(string? title, string? content) => !string.IsNullOrWhiteSpace(title) && title.Length <= 200 && content is not null && content.Length <= 20000;
static string Hash(string token) => Convert.ToHexString(SHA256.HashData(Encoding.ASCII.GetBytes(token)));
static bool Matches(string token, string hash) => !string.IsNullOrWhiteSpace(token) && CryptographicOperations.FixedTimeEquals(Convert.FromHexString(Hash(token)), Convert.FromHexString(hash));
static int LeaseSeconds(IConfiguration config) => Math.Max(1, config.GetValue<int?>("LeaseDurationSeconds") ?? 1800);

static Item? GetItem(SqliteConnection db, string id)
{
    using var rows = Store.Sql(db, "SELECT id,section,owner_section,title,content,version FROM items WHERE id=$id", ("$id", id)).ExecuteReader();
    return rows.Read() ? new Item(rows.GetString(0), rows.GetString(1), rows.GetString(2), rows.GetString(3), rows.GetString(4), rows.GetInt32(5)) : null;
}
static string? Creator(SqliteConnection db, string id) => Store.Sql(db, "SELECT created_by FROM items WHERE id=$id", ("$id", id)).ExecuteScalar() as string;
static Lease? GetLease(SqliteConnection db, string id)
{
    using var rows = Store.Sql(db, "SELECT holder,token_hash,expires_at,base_version FROM leases WHERE item_id=$id", ("$id", id)).ExecuteReader();
    return rows.Read() ? new Lease(rows.GetString(0), rows.GetString(1), DateTimeOffset.Parse(rows.GetString(2)), rows.GetInt32(3)) : null;
}
static object? LeaseView(SqliteDataReader rows) => rows.IsDBNull(6) ? null : new { holder = rows.GetString(6), expiresAt = rows.GetString(7) };
static object? LeaseObject(Lease? lease) => lease is null ? null : new { holder = lease.Holder, expiresAt = lease.ExpiresAt };
static IResult Conflict(SqliteConnection db, string id, string actor, string error, Lease? lease)
{
    var item = GetItem(db, id)!;
    using var rows = Store.Sql(db, "SELECT title,content,saved_at FROM drafts WHERE item_id=$id AND editor=$actor", ("$id", id), ("$actor", actor)).ExecuteReader();
    object? draft = rows.Read() ? new { title = rows.GetString(0), content = rows.GetString(1), savedAt = rows.GetString(2) } : null;
    return Results.Conflict(new { error, latest = new { item.Title, item.Content, item.Version }, draft, lease = LeaseObject(lease) });
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

record User(string EmpNo, string Name, string Role, string? Section);
record Item(string Id, string Section, string OwnerSection, string Title, string Content, int Version);
record Lease(string Holder, string TokenHash, DateTimeOffset ExpiresAt, int BaseVersion);
record CreateReport(string MeetingDate);
record CreateItem(string Section, string Title, string? OwnerSection);
record DraftRequest(string Title, string Content);
record TokenRequest(string Token);
record CommitRequest(string Token, int BaseVersion);
record TakeoverRequest(string Reason);
static class ReportSections
{
    public static readonly string[] All = ["summary", "projects", "operations", "personnel", "technology", "appendix"];
}

