namespace FurZone;

/// <summary>Which pages may load inside the app window; everything else opens in the normal browser.</summary>
public static class NavigationPolicy
{
    public const string AppHost = "app.furzone.local";
    public const string StartUrl = "https://" + AppHost + "/index.html";

    public static bool IsApp(Uri? uri) =>
        uri is { Scheme: "https" } && string.Equals(uri.Host, AppHost, StringComparison.OrdinalIgnoreCase);

    public static bool AllowedInApp(Uri? uri)
    {
        if (uri is null || uri.Scheme != "https") return false;
        var host = uri.Host.ToLowerInvariant();
        if (host == AppHost) return true;
        // Discord's login page, and our Supabase project's sign-in endpoints that hand back to the app.
        if (host == "discord.com" || host.EndsWith(".discord.com", StringComparison.Ordinal)) return true;
        return (host.EndsWith(".supabase.co", StringComparison.Ordinal) || host.EndsWith(".supabase.in", StringComparison.Ordinal))
               && uri.AbsolutePath.StartsWith("/auth/v1/", StringComparison.Ordinal);
    }

    /// <summary>Links we hand to the system browser: https only, nothing that could run a program.</summary>
    public static bool SafeExternal(Uri? uri) => uri is { Scheme: "https", IsAbsoluteUri: true } && !string.IsNullOrEmpty(uri.Host);
}
