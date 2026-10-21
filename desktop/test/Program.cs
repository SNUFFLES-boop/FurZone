// Tests for the Windows app's security checks (run on any OS): dotnet run --project desktop/test
using System.Security.Cryptography;
using FurZone;

var passed = 0;
void Check(bool ok, string what)
{
    if (!ok) throw new Exception("FAILED: " + what);
    passed++;
}
async Task Refused(string what, Func<Task> f)
{
    try { await f(); }
    catch (InvalidDataException) { passed++; return; }
    throw new Exception("FAILED (not refused): " + what);
}

// Navigation
Check(NavigationPolicy.AllowedInApp(new Uri("https://app.furzone.local/index.html#/home")), "app page");
Check(NavigationPolicy.AllowedInApp(new Uri("https://discord.com/oauth2/authorize?client_id=1")), "discord login");
Check(NavigationPolicy.AllowedInApp(new Uri("https://abcd.supabase.co/auth/v1/authorize?provider=discord")), "supabase auth");
Check(!NavigationPolicy.AllowedInApp(new Uri("https://abcd.supabase.co/rest/v1/posts")), "supabase api is not a page");
Check(!NavigationPolicy.AllowedInApp(new Uri("https://discord.com.evil.example/login")), "lookalike");
Check(!NavigationPolicy.AllowedInApp(new Uri("http://app.furzone.local/")), "plain http");
Check(!NavigationPolicy.AllowedInApp(new Uri("https://example.com/")), "random site");
Check(NavigationPolicy.IsApp(new Uri("https://APP.furzone.local/x")), "app host any case");
Check(!NavigationPolicy.IsApp(new Uri("https://discord.com/")), "discord is not the app");
Check(!NavigationPolicy.SafeExternal(new Uri("file:///C:/Windows/System32/calc.exe")), "no files");
Check(NavigationPolicy.SafeExternal(new Uri("https://vrchat.com/home")), "https link");

// Update URLs
var prefix = VerifiedDownload.ReleasesPrefix("SNUFFLES-boop/FurZone");
Check(VerifiedDownload.AllowedUrl(prefix + "v1.0.42/FurZone_Setup.exe", prefix), "release asset");
Check(!VerifiedDownload.AllowedUrl("https://github.com/evil/FurZone/releases/download/v1/FurZone_Setup.exe", prefix), "other owner");
Check(!VerifiedDownload.AllowedUrl(prefix + "../../x/evil.exe", prefix), "path climbing");
Check(!VerifiedDownload.AllowedUrl(prefix + "v1/FurZone_Setup.exe?x=1", prefix), "query");

// Download checks
var data = RandomNumberGenerator.GetBytes(300_000);
var sha = Convert.ToHexStringLower(SHA256.HashData(data));
var outStream = new MemoryStream();
var last = 0;
await VerifiedDownload.CopyVerifiedAsync(new MemoryStream(data), outStream, sha.ToUpperInvariant(), data.Length, new SyncProgress(p => last = p));
Check(outStream.Length == data.Length && last == 100, "good download");
await Refused("wrong checksum", () => VerifiedDownload.CopyVerifiedAsync(new MemoryStream(data), Stream.Null, new string('0', 64), data.Length, null));
await Refused("no checksum", () => VerifiedDownload.CopyVerifiedAsync(new MemoryStream(data), Stream.Null, "", data.Length, null));
await Refused("too big", () => VerifiedDownload.CopyVerifiedAsync(new MemoryStream(data), Stream.Null, sha, data.Length - 1, null));
await Refused("cut short", () => VerifiedDownload.CopyVerifiedAsync(new MemoryStream(data), Stream.Null, sha, data.Length + 1, null));
await Refused("bad url", () => VerifiedDownload.DownloadAsync(new HttpClient(), "https://example.com/x.exe", prefix, sha, 1, Path.GetTempFileName(), null));

Console.WriteLine($"{passed} desktop checks passed");

sealed class SyncProgress(Action<int> report) : IProgress<int>
{
    public void Report(int value) => report(value);
}
