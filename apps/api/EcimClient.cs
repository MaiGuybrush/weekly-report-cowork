using System.Text.Json;

public sealed class EcimClient(HttpClient http, IConfiguration config)
{
    public async Task<IReadOnlyList<EcimWork>> ReviewWork(EcimMember member, CancellationToken cancellationToken)
    {
        var baseUrl = config["Ecim:BaseUrl"];
        if (string.IsNullOrWhiteSpace(baseUrl)) throw new InvalidOperationException("eCIM is not configured");
        var query = new Dictionary<string, string?>
        {
            ["updateDateFrom"] = member.UpdateDateFrom,
            ["updateDateTo"] = member.UpdateDateTo,
            ["userId"] = member.UserId,
            ["timeFrom"] = member.TimeFrom,
            ["timeTo"] = member.TimeTo,
            ["division"] = member.Division,
            ["dept"] = member.Dept,
            ["section"] = member.Section,
            ["teamId"] = member.TeamId
        };
        var parameters = string.Join("&", query.Where(entry => !string.IsNullOrWhiteSpace(entry.Value)).Select(entry => $"{Uri.EscapeDataString(entry.Key)}={Uri.EscapeDataString(entry.Value!)}"));
        var path = config["Ecim:ReviewWorkPath"] ?? "/Work/ReviewWork";
        var uri = new Uri(new Uri(baseUrl.TrimEnd('/') + "/"), path.TrimStart('/') + (parameters.Length == 0 ? "" : "?" + parameters));
        using var request = new HttpRequestMessage(HttpMethod.Get, uri);
        if (!string.IsNullOrWhiteSpace(config["Ecim:ApiKey"])) request.Headers.Add("X-Api-Key", config["Ecim:ApiKey"]);
        using var response = await http.SendAsync(request, cancellationToken);
        response.EnsureSuccessStatusCode();
        using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(cancellationToken));
        var entries = document.RootElement.ValueKind == JsonValueKind.Array ? document.RootElement : FindArray(document.RootElement);
        if (entries.ValueKind != JsonValueKind.Array) throw new InvalidOperationException("eCIM ReviewWork response does not contain an array");
        var work = new List<EcimWork>();
        foreach (var entry in entries.EnumerateArray())
        {
            var id = Property(entry, "workId") ?? Property(entry, "id");
            if (!string.IsNullOrWhiteSpace(id)) work.Add(new EcimWork(id, entry.GetRawText()));
        }
        return work;
    }

    static JsonElement FindArray(JsonElement root)
    {
        foreach (var name in new[] { "data", "result", "results", "items" })
            if (root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.Array) return value;
        return default;
    }

    static string? Property(JsonElement objectValue, string name)
    {
        foreach (var property in objectValue.EnumerateObject())
            if (string.Equals(property.Name, name, StringComparison.OrdinalIgnoreCase)) return property.Value.ToString();
        return null;
    }
}

public sealed record EcimMember(string Section, string UserId, string? UpdateDateFrom, string? UpdateDateTo, string? TimeFrom, string? TimeTo, string? Division, string? Dept, string? TeamId);
public sealed record EcimWork(string WorkId, string Payload);
