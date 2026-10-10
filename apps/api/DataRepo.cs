using System.Diagnostics;
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
            if (HasRemoteHeads()) Git("pull", "--ff-only", "origin", Branch());
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
