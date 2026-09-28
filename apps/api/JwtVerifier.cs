using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

public sealed class JwtVerifier(HttpClient client, IConfiguration config, ILogger<JwtVerifier> log)
{
    readonly Dictionary<string, RSAParameters> keys = new();
    readonly SemaphoreSlim gate = new(1, 1);

    public async Task<string?> Verify(string? bearer)
    {
        if (bearer is null || !bearer.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)) return null;
        var token = bearer[7..].Split('.');
        if (token.Length != 3) return null;
        try
        {
            using var header = JsonDocument.Parse(Decode(token[0]));
            using var payload = JsonDocument.Parse(Decode(token[1]));
            if (header.RootElement.GetProperty("alg").GetString() != "RS256") return null;
            var kid = header.RootElement.GetProperty("kid").GetString();
            if (string.IsNullOrEmpty(kid)) return null;
            var key = await GetKey(kid);
            if (key is null) return null;
            using var rsa = RSA.Create();
            rsa.ImportParameters(key.Value);
            if (!rsa.VerifyData(Encoding.ASCII.GetBytes(token[0] + "." + token[1]), Decode(token[2]), HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)) return null;
            var claims = payload.RootElement;
            if (!claims.TryGetProperty("exp", out var exp) || exp.ValueKind != JsonValueKind.Number || exp.GetInt64() <= DateTimeOffset.UtcNow.ToUnixTimeSeconds()) return null;
            if (!claims.TryGetProperty("empNo", out var id) || id.ValueKind != JsonValueKind.String) return null;
            return string.IsNullOrWhiteSpace(id.GetString()) ? null : id.GetString();
        }
        catch (Exception ex) when (ex is JsonException or FormatException or KeyNotFoundException or ArgumentException or OverflowException or CryptographicException)
        {
            return null;
        }
    }

    async Task<RSAParameters?> GetKey(string kid)
    {
        await gate.WaitAsync();
        try
        {
            if (keys.TryGetValue(kid, out var cached)) return cached;
            var url = config["JwksUrl"] ?? throw new InvalidOperationException("JwksUrl is required");
            using var response = await client.GetAsync(url);
            response.EnsureSuccessStatusCode();
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var next = new Dictionary<string, RSAParameters>();
            foreach (var jwk in document.RootElement.GetProperty("keys").EnumerateArray())
            {
                if (jwk.GetProperty("kty").GetString() != "RSA") continue;
                if (jwk.TryGetProperty("alg", out var alg) && alg.GetString() != "RS256") continue;
                var id = jwk.GetProperty("kid").GetString();
                if (id is null) continue;
                next[id] = new RSAParameters { Modulus = Decode(jwk.GetProperty("n").GetString()!), Exponent = Decode(jwk.GetProperty("e").GetString()!) };
            }
            keys.Clear();
            foreach (var entry in next) keys[entry.Key] = entry.Value;
            return keys.TryGetValue(kid, out var found) ? found : null;
        }
        catch (Exception ex)
        {
            log.LogWarning(ex, "UAC JWKS refresh failed");
            return null;
        }
        finally { gate.Release(); }
    }

    static byte[] Decode(string value)
    {
        value = value.Replace('-', '+').Replace('_', '/');
        return Convert.FromBase64String(value.PadRight((value.Length + 3) / 4 * 4, '='));
    }
}
