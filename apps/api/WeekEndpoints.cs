using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;

public static class WeekEndpoints
{
    const int MaxBytes = 1024 * 1024;
    static readonly JsonSerializerOptions Pretty = new() { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping };

    static string? Str(JsonNode? node) => node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    public static void MapWeekEndpoints(this WebApplication app)
    {
        app.MapGet("/api/weeks", (DataRepo repo) => repo.Configured ? Results.Ok(repo.Weeks()) : Results.Ok(Array.Empty<string>()));

        app.MapGet("/api/weeks/{week}", (DataRepo repo, string week) =>
        {
            if (!DataRepo.ValidWeek(week)) return Results.BadRequest(new { error = "invalid week" });
            if (!repo.Configured) return Results.StatusCode(503);
            var result = new Dictionary<string, JsonNode?>();
            foreach (var file in DataRepo.Files)
                result[file] = repo.Read(week, file) is { } text ? JsonNode.Parse(text) : new JsonObject();
            return Results.Json(result);
        });

        app.MapPut("/api/weeks/{week}/{file}", async (HttpContext ctx, DataRepo repo, string week, string file) =>
        {
            if (!DataRepo.ValidWeek(week) || !DataRepo.ValidFile(file)) return Results.BadRequest(new { error = "invalid week or file" });
            var user = (User)ctx.Items["user"]!;
            var allowed = file == "cross" ? user.Role == "Guy" : user.Role == "Head" && user.Section == file;
            if (!allowed) return Results.StatusCode(403);
            if (!repo.Configured) return Results.StatusCode(503);
            if (ctx.Request.ContentLength > MaxBytes) return Results.StatusCode(413);
            using var buffer = new MemoryStream();
            await ctx.Request.Body.CopyToAsync(buffer);
            if (buffer.Length > MaxBytes) return Results.StatusCode(413);
            JsonObject? body;
            try { body = JsonNode.Parse(buffer.ToArray()) as JsonObject; }
            catch (JsonException) { body = null; }
            if (body is null) return Results.BadRequest(new { error = "body must be a JSON object" });
            if (Str(body["week"]) != week) return Results.BadRequest(new { error = "week does not match path" });
            if (file != "cross" && Str(body["section"]) != file) return Results.BadRequest(new { error = "section does not match path" });
            try { await repo.Write(week, file, body.ToJsonString(Pretty), user.EmpNo); }
            catch (GitException e) { return Results.Json(new { error = e.Message }, statusCode: 500); }
            return Results.NoContent();
        });
    }
}
