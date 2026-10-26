using System.Text.Json.Nodes;

/// <summary>Merge of two engineer-work files: works are matched by workId at every level; works the new file lacks are kept and flagged absent.</summary>
public static class EngineerMerge
{
    public static JsonObject Merge(JsonObject? old, JsonObject upload)
    {
        var result = (JsonObject)upload.DeepClone();
        var results = new JsonObject();
        var newResults = upload["results"] as JsonObject ?? new JsonObject();
        var oldResults = old?["results"] as JsonObject ?? new JsonObject();
        foreach (var (name, node) in newResults)
        {
            var engineer = (JsonObject)node!.DeepClone();
            engineer["items"] = MergeItems(oldResults[name]?["items"] as JsonArray, engineer["items"] as JsonArray);
            results[name] = engineer;
        }
        foreach (var (name, node) in oldResults)
            if (!newResults.ContainsKey(name)) results[name] = MarkAbsent((JsonObject)node!.DeepClone());
        result["results"] = results;
        return result;
    }

    static JsonObject MarkAbsent(JsonObject engineer)
    {
        engineer["items"] = new JsonArray((engineer["items"] as JsonArray ?? []).Select(i => (JsonNode)Absent((JsonObject)i!.DeepClone())).ToArray());
        return engineer;
    }

    static JsonObject Absent(JsonObject item)
    {
        item["absent"] = true;
        item["subItems"] = new JsonArray((item["subItems"] as JsonArray ?? []).Select(i => (JsonNode)Absent((JsonObject)i!.DeepClone())).ToArray());
        return item;
    }

    static JsonArray MergeItems(JsonArray? old, JsonArray? fresh)
    {
        var merged = new JsonArray();
        var oldById = (old ?? []).OfType<JsonObject>().Where(o => o["workId"] is not null).GroupBy(o => o["workId"]!.ToJsonString()).ToDictionary(g => g.Key, g => g.Last());
        var seen = new HashSet<string>();
        foreach (var item in (fresh ?? []).OfType<JsonObject>())
        {
            var copy = (JsonObject)item.DeepClone();
            var key = item["workId"]?.ToJsonString();
            JsonObject? previous = null;
            if (key is not null && oldById.TryGetValue(key, out previous)) seen.Add(key);
            copy["subItems"] = MergeItems(previous?["subItems"] as JsonArray, item["subItems"] as JsonArray);
            merged.Add(copy);
        }
        foreach (var (key, item) in oldById)
            if (!seen.Contains(key)) merged.Add(Absent((JsonObject)item.DeepClone()));
        return merged;
    }
}
