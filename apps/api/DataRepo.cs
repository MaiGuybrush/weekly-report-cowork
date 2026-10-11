using System.Diagnostics;
using System.Globalization;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

public sealed class GitException(string message) : Exception(message);

/// <summary>Working copy of the data repo: whitelisted paths, file IO, git CLI.</summary>
public sealed partial class DataRepo(IConfiguration config)
{
    public static readonly string[] Files = ["s1", "s2", "s3", "cross"];

    // ponytail: global lock; one writer per file and a handful of users, revisit only if writes queue visibly
    readonly SemaphoreSlim writeLock = new(1, 1);
    bool ready;

    string Root => config["DataRepo:Path"] ?? "";
    string Remote => config["DataRepo:Remote"] ?? "";
    public bool Configured => !string.IsNullOrWhiteSpace(Root);

    [GeneratedRegex(@"^[0-9]{4}-W[0-9]{2}\z")]
    private static partial Regex WeekPattern();
    public static bool ValidWeek(string week) => WeekPattern().IsMatch(week);
    public static bool ValidFile(string file) => Files.Contains(file);

    // Path is built only from a validated week and a whitelisted file name.
    string PathOf(string week, string file) => !ValidWeek(week) || !ValidFile(file) ? throw new ArgumentException("invalid week or file") : Path.Combine(Root, "weeks", week, file + ".json");

    public IEnumerable<string> Weeks()
    {
        var dir = Path.Combine(Root, "weeks");
        if (!Directory.Exists(dir)) return [];
        return Directory.GetDirectories(dir).Select(d => Path.GetFileName(d)).Where(ValidWeek).OrderByDescending(w => w, StringComparer.Ordinal);
    }

    public string? Read(string week, string file)
    {
        var path = PathOf(week, file);
        return File.Exists(path) ? File.ReadAllText(path) : null;
    }

    public async Task Write(string week, string file, string json, string empNo)
    {
        await writeLock.WaitAsync();
        try
        {
            EnsureReady();
            if (HasRemoteHeads()) Sync();
            var path = PathOf(week, file);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temp = path + ".tmp";
            File.WriteAllText(temp, json);
            File.Move(temp, path, overwrite: true);
            var relative = $"weeks/{week}/{file}.json";
            Git("add", "--", relative);
            if (Git("status", "--porcelain", "--", relative).Length > 0)
                Git("commit", "-m", $"{week}/{file}: update by {empNo}", "--", relative);
            if (Remote.Length > 0) Git("push", "-u", "origin", "HEAD");
        }
        finally { writeLock.Release(); }
    }

    string IndexPath => Path.Combine(Root, "publications", "index.json");

    public JsonObject Publications() =>
        File.Exists(IndexPath) && JsonNode.Parse(File.ReadAllText(IndexPath)) is JsonObject index ? index : new JsonObject { ["publications"] = new JsonArray() };

    public string? ReadPublication(string week, int version, string file)
    {
        if (!ValidWeek(week) || !ValidFile(file)) throw new ArgumentException("invalid week or file");
        var path = Path.Combine(Root, "publications", week, $"v{version}", file + ".json");
        return File.Exists(path) ? File.ReadAllText(path) : null;
    }

    /// <summary>Copies the draft into an immutable snapshot, appends to the index, commits, tags and pushes. Null when the week has no draft.</summary>
    public async Task<JsonObject?> Publish(string week, string empNo)
    {
        if (!ValidWeek(week)) throw new ArgumentException("invalid week");
        await writeLock.WaitAsync();
        try
        {
            EnsureReady();
            if (HasRemoteHeads()) Sync();
            var drafts = Files.Where(f => File.Exists(PathOf(week, f))).ToList();
            if (drafts.Count == 0) return null;
            var index = Publications();
            var list = index["publications"] as JsonArray ?? new JsonArray();
            index["publications"] = list;
            var version = list.Select(p => (p?["week"]?.GetValue<string>() == week ? p["version"]?.GetValue<int>() : null) ?? 0).DefaultIfEmpty(0).Max() + 1;
            var relative = $"publications/{week}/v{version}";
            var directory = Path.Combine(Root, "publications", week, $"v{version}");
            Directory.CreateDirectory(directory);
            foreach (var f in drafts) File.Copy(PathOf(week, f), Path.Combine(directory, f + ".json"), overwrite: false);
            var entry = new JsonObject { ["week"] = week, ["version"] = version, ["publishedAt"] = DateTime.UtcNow.ToString("o"), ["publishedBy"] = empNo, ["path"] = relative };
            list.Add(entry);
            File.WriteAllText(IndexPath, index.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
            Git("add", "--", relative, "publications/index.json");
            Git("commit", "-m", $"{week}: publish v{version} by {empNo}");
            var tag = $"pub/{week}-v{version}";
            Git("tag", tag);
            if (Remote.Length > 0) Git("push", "-u", "origin", "HEAD", $"refs/tags/{tag}");
            return entry;
        }
        finally { writeLock.Release(); }
    }

    /// <summary>Creates the week after the latest published one (or after the newest draft week, or this week) from the latest snapshot, else empty files. Null when that week already exists.</summary>
    public async Task<string?> CreateNextWeek(string empNo)
    {
        await writeLock.WaitAsync();
        try
        {
            EnsureReady();
            if (HasRemoteHeads()) Sync();
            var latest = (Publications()["publications"] as JsonArray)?.LastOrDefault() as JsonObject;
            var baseWeek = latest?["week"]?.GetValue<string>() ?? Weeks().FirstOrDefault();
            var next = NextWeek(baseWeek);
            if (Directory.Exists(Path.Combine(Root, "weeks", next))) return null;
            Directory.CreateDirectory(Path.Combine(Root, "weeks", next));
            foreach (var f in Files)
            {
                JsonObject content = new();
                if (latest is not null && ReadPublication(baseWeek!, latest["version"]!.GetValue<int>(), f) is { } text && JsonNode.Parse(text) is JsonObject copy) content = copy;
                else if (f != "cross") content["section"] = f;
                content["week"] = next;
                File.WriteAllText(PathOf(next, f), content.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
            }
            Git("add", "--", $"weeks/{next}");
            Git("commit", "-m", $"{next}: create by {empNo}", "--", $"weeks/{next}");
            if (Remote.Length > 0) Git("push", "-u", "origin", "HEAD");
            return next;
        }
        finally { writeLock.Release(); }
    }

    static string NextWeek(string? week)
    {
        var monday = week is null ? ISOWeek.ToDateTime(ISOWeek.GetYear(DateTime.Today), ISOWeek.GetWeekOfYear(DateTime.Today), DayOfWeek.Monday) - TimeSpan.FromDays(7)
            : ISOWeek.ToDateTime(int.Parse(week[..4]), int.Parse(week[6..]), DayOfWeek.Monday);
        var next = monday.AddDays(7);
        return $"{ISOWeek.GetYear(next)}-W{ISOWeek.GetWeekOfYear(next):00}";
    }

    void EnsureReady()
    {
        if (ready) return;
        if (!Directory.Exists(Path.Combine(Root, ".git")))
        {
            Directory.CreateDirectory(Root);
            if (Remote.Length > 0) Git("clone", Remote, ".");
            else Git("init");
        }
        ready = true;
    }

    // Rebase so unpushed local commits (after a failed push) replay on top of remote; abort and ask for a human on conflict.
    void Sync()
    {
        try { Git("pull", "--rebase", "--autostash", "origin", Branch()); }
        catch (GitException e)
        {
            try { Git("rebase", "--abort"); } catch (GitException) { }
            throw new GitException($"data repo needs manual intervention (pull --rebase failed): {e.Message}");
        }
    }

    string Branch() => Git("rev-parse", "--abbrev-ref", "HEAD").Trim();

    // Empty remote (fresh bare repo) has nothing to pull yet.
    bool HasRemoteHeads() => Remote.Length > 0 && Git("ls-remote", "--heads", "origin").Length > 0;

    string Git(params string[] args)
    {
        var info = new ProcessStartInfo("git") { WorkingDirectory = Root, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var a in new[] { "-c", "user.name=weekly-report", "-c", "user.email=weekly-report@localhost", "-c", "core.quotepath=false" }.Concat(args)) info.ArgumentList.Add(a);
        info.Environment["GIT_TERMINAL_PROMPT"] = "0";
        using var process = Process.Start(info)!;
        var stderr = process.StandardError.ReadToEndAsync();
        var stdout = process.StandardOutput.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0)
        {
            var first = stderr.Result.Split('\n', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault()?.Trim() ?? $"git {args[0]} failed";
            throw new GitException(first);
        }
        return stdout;
    }
}
