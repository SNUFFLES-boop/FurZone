using System.Diagnostics;
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Pawst;

/// <summary>
/// The Pawst window: the app's web code (installed next to Pawst.exe in "web") shown in WebView2 at
/// https://app.pawst.local, with dev tools off, no host objects, and only the app, Discord's login and
/// our Supabase sign-in allowed inside. Talks to the page only through JSON messages from the app's own origin.
/// </summary>
public sealed class MainForm : Form
{
    private readonly WebView2 web = new() { Dock = DockStyle.Fill, DefaultBackgroundColor = Color.FromArgb(15, 11, 26) };
    private readonly HttpClient http;
    private readonly int versionCode;
    private readonly string githubRepo;
    private bool updating;

    public MainForm()
    {
        Text = "Pawst";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        BackColor = Color.FromArgb(15, 11, 26);
        MinimumSize = new Size(420, 640);
        Size = new Size(1280, 840);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(web);

        var meta = typeof(MainForm).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().ToDictionary(a => a.Key, a => a.Value);
        versionCode = int.TryParse(meta.GetValueOrDefault("VersionCode"), out var v) ? v : 0;
        githubRepo = meta.GetValueOrDefault("GitHubRepo") ?? "SNUFFLES-boop/Pawst";

        http = new HttpClient(new SocketsHttpHandler { AllowAutoRedirect = true, MaxAutomaticRedirections = 5 })
        {
            Timeout = TimeSpan.FromMinutes(15)
        };
        http.DefaultRequestHeaders.UserAgent.ParseAdd($"Pawst-Windows/1.0.{versionCode}");
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        NativeMethods.UseDarkTitleBar(Handle);
    }

    protected override async void OnLoad(EventArgs e)
    {
        base.OnLoad(e);
        try
        {
            var data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Pawst", "WebView2");
            var env = await CoreWebView2Environment.CreateAsync(null, data, new CoreWebView2EnvironmentOptions());
            await web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            var go = MessageBox.Show(this,
                "Pawst needs Microsoft Edge WebView2, which comes with Windows 11 and up-to-date Windows 10.\n\nOpen the download page now?",
                "Pawst", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (go == DialogResult.Yes) OpenExternal("https://go.microsoft.com/fwlink/p/?LinkId=2124703");
            Close();
            return;
        }

        var core = web.CoreWebView2;
        var s = core.Settings;
        s.AreDevToolsEnabled = false;
        s.AreHostObjectsAllowed = false;
        s.IsWebMessageEnabled = true;
        s.IsStatusBarEnabled = false;
        s.IsPasswordAutosaveEnabled = false;
        s.IsGeneralAutofillEnabled = false;
        s.AreBrowserAcceleratorKeysEnabled = false;
        s.IsBuiltInErrorPageEnabled = true;
        s.UserAgent += $" PawstWindows/1.0.{versionCode}";

        var webRoot = Path.Combine(AppContext.BaseDirectory, "web");
        core.SetVirtualHostNameToFolderMapping(NavigationPolicy.AppHost, webRoot, CoreWebView2HostResourceAccessKind.Deny);

        core.NavigationStarting += (_, args) =>
        {
            if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) && NavigationPolicy.AllowedInApp(uri)) return;
            args.Cancel = true;
            OpenExternal(args.Uri);
        };
        core.FrameNavigationStarting += (_, args) =>
        {
            // Frames only for Discord's own login page (its captcha); never inside the app itself.
            if (!Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) || uri.Scheme != "https" || NavigationPolicy.IsApp(new Uri(core.Source)))
                args.Cancel = true;
        };
        core.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            OpenExternal(args.Uri);
        };
        core.PermissionRequested += (_, args) =>
        {
            // Clipboard for copying the VRChat code; nothing else (camera, location, notifications...).
            args.State = args.PermissionKind == CoreWebView2PermissionKind.ClipboardRead
                ? CoreWebView2PermissionState.Allow
                : CoreWebView2PermissionState.Deny;
        };
        core.DocumentTitleChanged += (_, _) => Text = "Pawst";
        core.WebMessageReceived += OnMessage;
        core.Navigate(NavigationPolicy.StartUrl);
    }

    private void OpenExternal(string? url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri) || !NavigationPolicy.SafeExternal(uri)) return;
        try
        {
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        }
        catch (Exception)
        {
            // No browser: nothing to do.
        }
    }

    private void Post(object message) => web.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(message));

    private async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        // Only the app's own page may talk to the app (not Discord's or any other page).
        if (!Uri.TryCreate(e.Source, UriKind.Absolute, out var source) || !NavigationPolicy.IsApp(source)) return;
        JsonNode? msg;
        try
        {
            msg = JsonNode.Parse(e.WebMessageAsJson);
        }
        catch (JsonException)
        {
            return;
        }
        var id = msg?["id"]?.GetValue<int>() ?? 0;
        var type = msg?["type"]?.GetValue<string>();
        try
        {
            switch (type)
            {
                case "versionCode":
                    Post(new { type = "reply", id, value = versionCode });
                    break;
                case "openExternal":
                    OpenExternal(msg?["url"]?.GetValue<string>());
                    Post(new { type = "reply", id, value = true });
                    break;
                case "installUpdate":
                    Post(new { type = "reply", id, value = true });
                    await InstallUpdate(msg?["url"]?.GetValue<string>(), msg?["sha256"]?.GetValue<string>(), msg?["size"]?.GetValue<long>() ?? 0);
                    break;
                default:
                    Post(new { type = "reply", id, error = "Unknown request" });
                    break;
            }
        }
        catch (Exception ex)
        {
            Post(new { type = "reply", id, error = ex.Message });
        }
    }

    /// <summary>Downloads the installer, checks it, then runs it silently and closes so it can replace files.</summary>
    private async Task InstallUpdate(string? url, string? sha256, long size)
    {
        if (updating) return;
        updating = true;
        var progress = new Progress<int>(p => Post(new { type = "update", state = "downloading", percent = p }));
        try
        {
            var dir = Path.Combine(Path.GetTempPath(), "PawstUpdate");
            Directory.CreateDirectory(dir);
            var file = Path.Combine(dir, $"Pawst_Setup_{Guid.NewGuid():N}.exe");
            await VerifiedDownload.DownloadAsync(http, url ?? "", VerifiedDownload.ReleasesPrefix(githubRepo), sha256, size, file, progress);
            Post(new { type = "update", state = "installing", percent = 100 });
            Process.Start(new ProcessStartInfo(file, "/S /UPDATE") { UseShellExecute = true });
            Close();
        }
        catch (Exception ex)
        {
            Post(new { type = "update", state = "error", percent = 0, message = ex.Message });
        }
        finally
        {
            updating = false;
        }
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            http.Dispose();
            web.Dispose();
        }
        base.Dispose(disposing);
    }
}
