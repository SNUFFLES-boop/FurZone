using System.Security.Cryptography;
using System.Text.RegularExpressions;

namespace Pawst;

/// <summary>
/// Downloads an update and refuses it unless it is exactly the file the release described: only from this
/// app's GitHub releases, the right size, the right SHA-256.
/// </summary>
public static partial class VerifiedDownload
{
    public const long MaxBytes = 400L * 1024 * 1024;

    public static string ReleasesPrefix(string repo) => $"https://github.com/{repo}/releases/download/";

    [GeneratedRegex("^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$")]
    private static partial Regex AssetPath();

    [GeneratedRegex("^[0-9a-f]{64}$")]
    private static partial Regex Sha256Hex();

    public static bool AllowedUrl(string? url, string prefix)
    {
        if (url is null || !url.StartsWith(prefix, StringComparison.Ordinal)) return false;
        var rest = url[prefix.Length..];
        return AssetPath().IsMatch(rest) && !rest.Contains("..", StringComparison.Ordinal);
    }

    public static string NormalizeSha(string? sha256)
    {
        var s = (sha256 ?? "").Trim().ToLowerInvariant();
        if (!Sha256Hex().IsMatch(s)) throw new InvalidDataException("This update has no valid checksum, so it can't be trusted.");
        return s;
    }

    /// <summary>Copies while hashing; throws if the size or checksum is wrong.</summary>
    public static async Task CopyVerifiedAsync(Stream input, Stream output, string? sha256, long size,
        IProgress<int>? progress, CancellationToken ct = default)
    {
        var want = NormalizeSha(sha256);
        if (size <= 0 || size > MaxBytes) throw new InvalidDataException("This update has no valid size.");
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        var buffer = new byte[81920];
        long done = 0;
        var lastPct = -1;
        int n;
        while ((n = await input.ReadAsync(buffer, ct)) > 0)
        {
            done += n;
            if (done > size) throw new InvalidDataException("The download is bigger than the update said.");
            hash.AppendData(buffer, 0, n);
            await output.WriteAsync(buffer.AsMemory(0, n), ct);
            var pct = (int)(done * 100 / size);
            if (pct != lastPct)
            {
                lastPct = pct;
                progress?.Report(pct);
            }
        }
        if (done != size) throw new InvalidDataException("The download stopped early. Try again.");
        if (Convert.ToHexStringLower(hash.GetHashAndReset()) != want)
            throw new InvalidDataException("The download doesn't match the update's checksum, so it wasn't installed.");
    }

    /// <summary>Downloads to a file; redirects are followed only over https.</summary>
    public static async Task<string> DownloadAsync(HttpClient http, string url, string prefix, string? sha256, long size,
        string targetFile, IProgress<int>? progress, CancellationToken ct = default)
    {
        if (!AllowedUrl(url, prefix)) throw new InvalidDataException("Updates only come from the app's own GitHub releases.");
        NormalizeSha(sha256);
        using var res = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
        if (res.RequestMessage?.RequestUri?.Scheme != "https") throw new InvalidDataException("Refused an insecure download link.");
        res.EnsureSuccessStatusCode();
        await using (var input = await res.Content.ReadAsStreamAsync(ct))
        await using (var output = new FileStream(targetFile, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            await CopyVerifiedAsync(input, output, sha256, size, progress, ct);
        }
        return targetFile;
    }
}
