using System.Globalization;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

/// <summary>Validation of an uploaded engineer-work file: the week comes from the file name, the shape from a minimal required-field check.</summary>
public static partial class EngineerUpload
{
    [GeneratedRegex(@"_([0-9]{6})(?:_[A-Za-z0-9]+)?\.json\z")]
    private static partial Regex NameDate();

    /// <summary>ISO week (yyyy-Www) of the date in a *_yyMMdd[_後綴].json name; null when the name does not fit.</summary>
    public static string? WeekOfFilename(string filename)
    {
        var m = NameDate().Match(filename);
        if (!m.Success || !DateTime.TryParseExact(m.Groups[1].Value, "yyMMdd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var date)) return null;
        return $"{ISOWeek.GetYear(date)}-W{ISOWeek.GetWeekOfYear(date):00}";
    }

    /// <summary>Reason the file is unusable, or null.</summary>
    public static string? Problem(JsonObject file)
    {
        if (file["target_section"] is not JsonValue) return "缺少 target_section";
        if (file["results"] is not JsonObject results) return "缺少 results";
        foreach (var (name, engineer) in results)
        {
            if (engineer?["items"] is not JsonArray items) return $"工程師 {name} 缺少 items";
            if (ItemProblem(items) is { } p) return $"工程師 {name}：{p}";
        }
        return null;
    }

    static string? ItemProblem(JsonArray items)
    {
        foreach (var node in items)
        {
            if (node is not JsonObject item || item["workId"] is not JsonValue id || !id.TryGetValue<long>(out _) || item["workContent"] is not JsonValue) return "工作缺少 workId 或 workContent";
            if (item["subItems"] is JsonArray subs && ItemProblem(subs) is { } p) return p;
        }
        return null;
    }
}
