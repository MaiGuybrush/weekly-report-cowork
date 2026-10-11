using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
builder.Logging.ClearProviders();
builder.Logging.AddConsole();
builder.Services.AddSingleton<DataRepo>();
builder.Services.AddHttpClient();
builder.Services.AddSingleton<JwtVerifier>();
builder.Services.AddCors(options => options.AddPolicy("web", policy =>
{
    var origins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
    policy.WithOrigins(origins).AllowAnyHeader().AllowAnyMethod();
}));
var app = builder.Build();
var users = app.Configuration.GetSection("Access:Users").GetChildren()
    .Where(u => !string.IsNullOrWhiteSpace(u["EmpNo"]) && u["Role"] is "Division" or "Head")
    .ToDictionary(u => u["EmpNo"]!, u => new User(u["EmpNo"]!, u["Name"] ?? u["EmpNo"]!, u["Role"]!, u["Section"]), StringComparer.OrdinalIgnoreCase);
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
    if (!users.TryGetValue(empNo, out var user)) { context.Response.StatusCode = 403; return; }
    context.Items["user"] = user;
    await next();
});

app.MapGet("/api/me", (HttpContext ctx) => Results.Ok((User)ctx.Items["user"]!));
app.MapWeekEndpoints();

if (Directory.Exists(webRoot)) app.MapFallback(async context =>
{
    if (context.Request.Path.StartsWithSegments("/api")) { context.Response.StatusCode = 404; return; }
    context.Response.ContentType = "text/html; charset=utf-8";
    await context.Response.SendFileAsync(Path.Combine(webRoot, "index.html"));
});
app.Run();

record User(string EmpNo, string Name, string Role, string? Section);
