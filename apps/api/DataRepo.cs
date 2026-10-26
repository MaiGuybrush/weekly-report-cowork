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

    [GeneratedRegex(@"_([0-9]{6})\.json\z")]
    private static partial Regex EngineerWorkName();

    /// <summary>Engineer-work file (server directory, outside the repo) whose name date falls in the week; latest wins.</summary>
    public string? ReadEngineerWork(string week)
    {
        var dir = config["EngineerWork:Path"];
        if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir) || !ValidWeek(week)) return null;
        var monday = ISOWeek.ToDateTime(int.Parse(week[..4]), int.Parse(week[6..]), DayOfWeek.Monday);
        var best = Directory.GetFiles(dir)
            .Select(f => (file: f, m: EngineerWorkName().Match(Path.GetFileName(f))))
            .Where(x => x.m.Success)
            .Select(x => (x.file, ok: DateTime.TryParseExact(x.m.Groups[1].Value, "yyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var d), date: d))
            .Where(x => x.ok && x.date >= monday && x.date < monday.AddDays(7))
            .OrderByDescending(x => x.date).ThenByDescending(x => x.file, StringComparer.Ordinal)
            .FirstOrDefault();
        return best.file is null ? null : File.ReadAllText(best.file);
    }

    string EngineerPath(string week, string section) => !ValidWeek(week) || !ValidFile(section) || section == "cross" ? throw new ArgumentException("invalid week or section") : Path.Combine(Root, "weeks", week, $"engineer-{section}.json");

    public string? ReadEngineer(string week, string section)
    {
        var path = EngineerPath(week, section);
        return File.Exists(path) ? File.ReadAllText(path) : null;
    }

    /// <summary>Newest week that already has engineer data for the section, or null.</summary>
    public string? LatestEngineerWeek(string section) =>
        Weeks().Where(w => File.Exists(EngineerPath(w, section))).FirstOrDefault();

    public bool WeekExists(string week) => Directory.Exists(Path.Combine(Root, "weeks", week));

    /// <summary>Merges the upload into the week's stored file by workId (missing works keep their last snapshot, flagged absent) and commits. Rejects with a reason when the week is older than existing data.</summary>
    public async Task<string?> WriteEngineer(string week, string section, JsonObject upload, string empNo)
    {
        await writeLock.WaitAsync();
        try
        {
            EnsureReady();
            if (HasRemoteHeads()) Sync();
            if (!WeekExists(week)) return $"週次 {week} 尚未建立";
            if (LatestEngineerWeek(section) is { } latest && string.CompareOrdinal(week, latest) < 0) return $"週次 {week} 早於已有資料的 {latest}";
            var path = EngineerPath(week, section);
            var merged = File.Exists(path) && JsonNode.Parse(File.ReadAllText(path)) is JsonObject old ? EngineerMerge.Merge(old, upload) : EngineerMerge.Merge(null, upload);
            SaveEngineer(week, section, merged, $"upload by {empNo}");
            return null;
        }
        finally { writeLock.Release(); }
    }

    void SaveEngineer(string week, string section, JsonObject content, string message)
    {
        var path = EngineerPath(week, section);
        var temp = path + ".tmp";
        File.WriteAllText(temp, content.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping }));
        File.Move(temp, path, overwrite: true);
        var relative = $"weeks/{week}/engineer-{section}.json";
        Git("add", "--", relative);
        if (Git("status", "--porcelain", "--", relative).Length > 0)
            Git("commit", "-m", $"{week}/engineer-{section}: {message}", "--", relative);
        if (Remote.Length > 0) Git("push", "-u", "origin", "HEAD");
    }

    /// <summary>Stores the head's star and comment on one work. False when the week has no engineer data or no such work.</summary>
    public async Task<bool> AnnotateEngineer(string week, string section, long workId, bool important, string comment, string empNo)
    {
        await writeLock.WaitAsync();
        try
        {
            EnsureReady();
            if (HasRemoteHeads()) Sync();
            if (ReadEngineer(week, section) is not { } text || JsonNode.Parse(text) is not JsonObject file || !EngineerMerge.Annotate(file, workId, important, comment)) return false;
            SaveEngineer(week, section, file, $"annotate {workId} by {empNo}");
            return true;
        }
        finally { writeLock.Release(); }
    }

    /// <summary>The week's engineer file with lastComment attached from the newest earlier week that has data for the section.</summary>
    public JsonObject? ReadEngineerForView(string week, string section)
    {
        if (ReadEngineer(week, section) is not { } text || JsonNode.Parse(text) is not JsonObject file) return null;
        var earlier = Weeks().FirstOrDefault(w => string.CompareOrdinal(w, week) < 0 && File.Exists(EngineerPath(w, section)));
        EngineerMerge.AttachLastComments(file, earlier is null ? null : JsonNode.Parse(ReadEngineer(earlier, section)!) as JsonObject);
        return file;
    }

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
            foreach (var f in drafts) File.WriteAllText(Path.Combine(directory, f + ".json"), WithoutPendingSync(File.ReadAllText(PathOf(week, f))));
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

    /// <summary>Unconfirmed sync records are internal: the published snapshot (and so the next week built from it) never carries them.</summary>
    static string WithoutPendingSync(string text)
    {
        if (JsonNode.Parse(text) is not JsonObject file || file["items"] is not JsonArray items) return text;
        foreach (var entry in items.OfType<JsonObject>().SelectMany(i => i["schedule"] is JsonArray s ? s.OfType<JsonObject>() : []))
        {
            entry.Remove("pendingSync");
            entry.Remove("rejectedSync");
        }
        return file.ToJsonString(new JsonSerializerOptions { WriteIndented = true, Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
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
