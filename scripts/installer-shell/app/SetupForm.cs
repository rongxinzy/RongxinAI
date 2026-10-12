using System.Runtime.InteropServices;
using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace ZhiYuan.Setup.Shell;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        // Silent uninstall runs headless: no window, no WebView2, engine events
        // mirrored to the same JSONL log the UI path writes. Unknown arguments
        // are ignored everywhere (ARP passes /S, --updated, etc.).
        if (SetupForm.IsUninstallMode(args) && args.Contains("--silent"))
        {
            Environment.ExitCode = SetupForm.RunSilentUninstall(args);
            return;
        }
        Application.Run(new SetupForm(args));
    }
}

/// <summary>
/// Borderless host window for the installer UI. The WebView2 surface fills the
/// client area; window chrome (drag, close) is negotiated with the page through
/// WebView2 host objects and web messages, so the visual design lives entirely
/// in HTML/CSS/JS and stays previewable in a plain browser.
///
/// Milestone A wiring: --payload &lt;dir&gt; points the real install engine at a
/// payload directory (SFX embedding is Milestone B), --install-dir overrides
/// the destination (headless verification), --auto-install starts immediately
/// with defaults, and engine events are pushed to the page as JSON messages.
/// Milestone C wiring: --uninstall (or being named uninstall.exe) opens the
/// uninstall confirmation page and drives the uninstall engine; --silent runs
/// it headless; unknown arguments are ignored (ARP passes /S, --updated, ...).
/// </summary>
public sealed class SetupForm : Form
{
    private const int WindowWidth = 860;
    private const int WindowHeight = 560;

    private readonly WebView2 webView = new();
    private readonly string? capturePreviewPath;
    private readonly int captureDelayMs;
    private readonly string? payloadDir;
    private readonly string? forcedInstallDir;
    private readonly string? runtimeRootOverride;
    private readonly string? appDataRootOverride;
    private readonly string? skipCleanupOf;
    private readonly bool skipRegistration;
    private readonly bool autoInstall;
    private readonly bool uninstallMode;
    private readonly bool autoUninstall;
    private readonly string[] rawArgs;
    private bool selfTestClose;

    private readonly InstallerEngine engine;
    private readonly CancellationTokenSource installCts = new();
    private readonly string eventsLogPath;
    private string installState = "idle";
    private string? lastLaunchPath;

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, int wParam, int lParam);

    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int attrValue, int attrSize);

    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HTCAPTION = 0x2;
    private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
    private const int DWMWCP_ROUNDED = 2;

    public SetupForm(string[] args)
    {
        rawArgs = args;
        var captureIndex = Array.FindIndex(args, a => a == "--capture-preview");
        if (captureIndex >= 0 && captureIndex + 1 < args.Length)
        {
            capturePreviewPath = args[captureIndex + 1];
        }
        captureDelayMs = int.TryParse(ValueAfter(args, "--capture-delay"), out var delay) && delay >= 0
            ? delay
            : 1200;
        selfTestClose = args.Contains("--self-test-close");
        autoInstall = args.Contains("--auto-install");
        autoUninstall = args.Contains("--auto-uninstall");
        uninstallMode = IsUninstallMode(args);
        skipRegistration = args.Contains("--skip-registration");
        payloadDir = ValueAfter(args, "--payload");
        forcedInstallDir = ValueAfter(args, "--install-dir");
        runtimeRootOverride = ValueAfter(args, "--runtime-root");
        appDataRootOverride = ValueAfter(args, "--app-data-root");
        skipCleanupOf = ValueAfter(args, "--skip-cleanup-of");
        eventsLogPath = Path.Combine(Path.GetTempPath(), "zy-setup-events.jsonl");

        Text = uninstallMode ? "知远智能体 卸载程序" : "知远智能体 安装程序";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(WindowWidth, WindowHeight);
        BackColor = Color.White;
        ShowInTaskbar = true;
        MaximizeBox = false;

        // The engine orchestrates the shared scripts; progress events are
        // forwarded to the page (and mirrored to a JSONL log for headless
        // verification of the event sequence). Without --payload the engine
        // self-extracts the zip appended to this exe (SFX, Milestone B).
        engine = new InstallerEngine(
            payloadDir,
            forcedInstallDir ?? DefaultInstallDir(),
            runtimeRootOverride,
            appDataRootOverride,
            registerInstall: !skipRegistration,
            new Progress<EngineEvent>(OnEngineEvent));

        webView.Dock = DockStyle.Fill;
        webView.DefaultBackgroundColor = Color.White;
        webView.CoreWebView2InitializationCompleted += OnWebViewReady;
        webView.WebMessageReceived += OnWebMessage;
        webView.NavigationCompleted += async (_, e) =>
        {
            DebugLog($"navigation completed: IsSuccess={e.IsSuccess} WebErrorStatus={e.WebErrorStatus} Uri={webView.Source}");
            if (selfTestClose && webView.CoreWebView2 is not null)
            {
                await Task.Delay(800);
                await webView.CoreWebView2.ExecuteScriptAsync(
                    "document.querySelector('.titlebar').dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true}))");
                await Task.Delay(500);
                await webView.CoreWebView2.ExecuteScriptAsync(
                    "document.querySelector('.win-btn.close').click()");
                DebugLog("self-test: drag + close dispatched");
            }
            if (autoInstall && webView.CoreWebView2 is not null)
            {
                // Let the page settle, then drive the same path as the hero
                // page Install click: real events, no simulated timing.
                await Task.Delay(1200);
                bridge.StartInstall(forcedInstallDir ?? DefaultInstallDir(), false);
            }
            if (autoUninstall && webView.CoreWebView2 is not null)
            {
                // Same idea for uninstall screenshots: confirm automatically so
                // --capture-preview can grab the real in-progress page.
                await Task.Delay(1200);
                bridge.StartUninstall();
            }
            if (capturePreviewPath is not null && webView.CoreWebView2 is not null)
            {
                await Task.Delay(captureDelayMs);
                using var stream = new MemoryStream();
                await webView.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
                File.WriteAllBytes(capturePreviewPath, stream.ToArray());
                DebugLog($"preview captured to {capturePreviewPath}");
                BeginInvoke(Close);
            }
        };
        Controls.Add(webView);

        FormClosed += (_, _) =>
        {
            // Best-effort temp cleanup for the materialized UI and any stale
            // extraction dirs from crashed runs.
            foreach (var dir in Directory.EnumerateDirectories(Path.GetTempPath(), "zhiyuan-setup-*"))
            {
                try { Directory.Delete(dir, recursive: true); } catch { }
            }
        };

        Load += async (_, _) =>
        {
            DebugLog("form load; ensuring CoreWebView2");
            try
            {
                await webView.EnsureCoreWebView2Async();
                DebugLog("CoreWebView2 ready");
            }
            catch (Exception ex)
            {
                DebugLog($"EnsureCoreWebView2 failed: {ex}");
            }
            if (Environment.OSVersion.Version.Build >= 22000)
            {
                var preference = DWMWCP_ROUNDED;
                DwmSetWindowAttribute(Handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref preference, sizeof(int));
            }
        };

        string uiPath = ResolveUiPath(args);
        var extraQueryIndex = Array.FindIndex(args, a => a == "--ui-query");
        var query = "shell=1";
        if (extraQueryIndex >= 0 && extraQueryIndex + 1 < args.Length)
        {
            query += "&" + args[extraQueryIndex + 1];
        }
        if (uninstallMode && !query.Contains("page=", StringComparison.Ordinal))
        {
            query += "&page=uninstall";
        }
        var uri = new UriBuilder("file", string.Empty)
        {
            Path = uiPath,
            Query = query,
        };
        webView.Source = uri.Uri;
    }

    private ShellBridge bridge = null!;

    public string CurrentInstallState => installState;

    public static string DefaultInstallDir()
    {
        var localPrograms = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs");
        return Path.Combine(localPrograms, "ZhiYuan Agent");
    }

    /// <summary>Uninstall mode comes from --uninstall or from being the copied
    /// uninstall.exe entry point the installer ships next to the app (ARP's
    /// UninstallString invokes it without any flag).</summary>
    public static bool IsUninstallMode(string[] args)
    {
        if (args.Contains("--uninstall")) return true;
        var processPath = Environment.ProcessPath;
        return processPath is not null
            && Path.GetFileName(processPath).Equals("uninstall.exe", StringComparison.OrdinalIgnoreCase);
    }

    private static string UninstallInstallDir(string[] args)
    {
        var forced = ValueAfter(args, "--install-dir");
        if (forced is not null) return Path.GetFullPath(forced);
        var processDir = Environment.ProcessPath is null ? null : Path.GetDirectoryName(Environment.ProcessPath);
        return processDir ?? DefaultInstallDir();
    }

    /// <summary>Headless silent uninstall: the engine reports to the same JSONL
    /// event log the UI path mirrors, so e2e can poll it; exit code 0/1. The
    /// progress handler runs inline (Progress&lt;T&gt; would post to the thread
    /// pool and the process could exit before the done event is written).</summary>
    public static int RunSilentUninstall(string[] args)
    {
        var eventsLogPath = Path.Combine(Path.GetTempPath(), "zy-setup-events.jsonl");
        var progress = new InlineProgress(evt =>
        {
            try
            {
                File.AppendAllText(eventsLogPath, evt.ToJson() + Environment.NewLine);
            }
            catch { /* diagnostics only */ }
        });
        var engine = new UninstallerEngine(
            UninstallInstallDir(args),
            ValueAfter(args, "--runtime-root"),
            ValueAfter(args, "--app-data-root"),
            ValueAfter(args, "--skip-cleanup-of"),
            progress);
        try
        {
            engine.UninstallAsync(CancellationToken.None).GetAwaiter().GetResult();
            return 0;
        }
        catch
        {
            return 1;
        }
    }

    internal static string? ValueAfter(string[] args, string flag)
    {
        var index = Array.FindIndex(args, a => a == flag);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }

    /// <summary>Synchronous IProgress so headless runs never lose the final
    /// events to a thread-pool race at process exit.</summary>
    private sealed class InlineProgress : IProgress<EngineEvent>
    {
        private readonly Action<EngineEvent> handler;

        public InlineProgress(Action<EngineEvent> handler) => this.handler = handler;

        public void Report(EngineEvent value) => handler(value);
    }

    private static string ResolveUiPath(string[] args)
    {
        var flagsWithValue = new HashSet<string> { "--capture-preview", "--capture-delay", "--ui-query", "--payload", "--install-dir", "--runtime-root", "--app-data-root", "--skip-cleanup-of" };
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i].StartsWith('-')) continue;
            if (i > 0 && flagsWithValue.Contains(args[i - 1])) continue;
            return Path.GetFullPath(args[i]);
        }
        var staged = Path.Combine(AppContext.BaseDirectory, "ui", "index.html");
        if (File.Exists(staged)) return staged;
        // Single-file SFX: no sidecar ui/ directory — materialize the embedded
        // page and brand assets into a temp dir for this process.
        var uiDir = Path.Combine(Path.GetTempPath(), "zhiyuan-setup-ui-" + Environment.ProcessId);
        try
        {
            Directory.CreateDirectory(Path.Combine(uiDir, "assets"));
            WriteEmbeddedResource("ui.index.html", Path.Combine(uiDir, "index.html"));
            WriteEmbeddedResource("ui.assets.logo", Path.Combine(uiDir, "assets", "zhiyuan-logo-light-1600.png"));
            WriteEmbeddedResource("ui.assets.icon", Path.Combine(uiDir, "assets", "256x256.png"));
            return Path.Combine(uiDir, "index.html");
        }
        catch
        {
            return staged;
        }
    }

    private static void WriteEmbeddedResource(string name, string target)
    {
        var assembly = typeof(SetupForm).Assembly;
        using var stream = assembly.GetManifestResourceStream(name)
            ?? throw new InvalidOperationException($"embedded resource missing: {name}");
        using var output = new FileStream(target, FileMode.Create, FileAccess.Write, FileShare.None);
        stream.CopyTo(output);
    }

    private void OnEngineEvent(EngineEvent evt)
    {
        if (evt.Type == "done") { installState = "done"; lastLaunchPath = evt.LaunchPath; }
        else if (evt.Type == "error") { installState = "cancelled"; }
        var json = evt.ToJson();
        try
        {
            File.AppendAllText(eventsLogPath, json + Environment.NewLine);
        }
        catch { /* diagnostics only */ }
        DebugLog($"engine event: {json}");
        var core = webView.CoreWebView2;
        if (core is null) return;
        try
        {
            if (IsHandleCreated)
            {
                BeginInvoke(() =>
                {
                    try
                    {
                        core.PostWebMessageAsJson(json);
                    }
                    catch (Exception postEx)
                    {
                        DebugLog($"post to webview failed: {postEx}");
                    }
                });
            }
        }
        catch (Exception invokeEx) { DebugLog($"beginInvoke failed: {invokeEx}"); }
    }

    private void OnWebViewReady(object? sender, CoreWebView2InitializationCompletedEventArgs e)
    {
        DebugLog($"initialization completed: IsSuccess={e.IsSuccess} Error={(e.IsSuccess ? null : e.InitializationException)}");
        if (!e.IsSuccess) return;
        webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
        webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
        bridge = new ShellBridge(this);
        webView.CoreWebView2.AddHostObjectToScript("shell", bridge);
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        var message = e.WebMessageAsJson;
        DebugLog($"web message: {message}");
        if (message.Contains("\"drag\""))
        {
            BeginInvoke(() =>
            {
                ReleaseCapture();
                SendMessage(Handle, WM_NCLBUTTONDOWN, HTCAPTION, 0);
            });
        }
        else if (message.Contains("\"close\""))
        {
            BeginInvoke(Close);
        }
    }

    internal void StartInstall(string engineInstallDir, bool localInference)
    {
        if (installState == "installing") return;
        installState = "installing";
        var core = webView.CoreWebView2;
        if (core is not null)
        {
            try { BeginInvoke(() => core.PostWebMessageAsJson("{\"type\":\"install-started\"}")); } catch { }
        }
        _ = Task.Run(async () =>
        {
            try
            {
                // The engine instance pins its install dir at construction;
                // a mismatched page-supplied dir restarts the run with a
                // fresh engine is overkill for v1 — the page reads the
                // default from GetDefaultInstallDir().
                await engine.RunAsync(localInference, installCts.Token);
            }
            catch
            {
                // the engine already reported the error/cancel event
            }
        });
    }

    internal void CancelInstall() => installCts.Cancel();

    internal void StartUninstall()
    {
        if (installState == "uninstalling") return;
        installState = "uninstalling";
        var core = webView.CoreWebView2;
        if (core is not null)
        {
            try { BeginInvoke(() => core.PostWebMessageAsJson("{\"type\":\"uninstall-started\"}")); } catch { }
        }
        var uninstaller = new UninstallerEngine(
            UninstallInstallDir(rawArgs),
            runtimeRootOverride,
            appDataRootOverride,
            skipCleanupOf,
            new Progress<EngineEvent>(OnEngineEvent));
        _ = Task.Run(async () =>
        {
            try
            {
                await uninstaller.UninstallAsync(installCts.Token);
            }
            catch
            {
                // the engine already reported the error/cancel event
            }
        });
    }

    internal void LaunchApp()
    {
        if (lastLaunchPath is null || !File.Exists(lastLaunchPath)) return;
        try
        {
            Process.Start(new ProcessStartInfo { FileName = lastLaunchPath, UseShellExecute = true });
        }
        catch { /* a fake or moved exe must not break the finish page */ }
    }

    private static void DebugLog(string message)
    {
        try
        {
            File.AppendAllText(
                Path.Combine(Path.GetTempPath(), "zy-shell.log"),
                $"[{DateTime.Now:HH:mm:ss.fff}] {message}{Environment.NewLine}");
        }
        catch
        {
            // diagnostics only
        }
    }
}

/// <summary>
/// Host object exposed to the page as window.chrome.webview.hostObjects.shell.
/// Must live OUTSIDE SetupForm: COM visibility of a nested class is limited by
/// its enclosing type, and AddHostObjectToScript rejects non-COM-visible types
/// with ArgumentException.
/// </summary>
[ComVisible(true)]
public sealed class ShellBridge
{
    private readonly SetupForm form;

    public ShellBridge(SetupForm form) => this.form = form;

    public void CloseWindow() => form.BeginInvoke(form.Close);

    public void MinimizeWindow() => form.BeginInvoke(() =>
    {
        form.WindowState = FormWindowState.Minimized;
    });

    public void StartInstall(string installPath, bool localInference)
        => form.StartInstall(installPath, localInference);

    public void StartUninstall() => form.StartUninstall();

    public void CancelInstall() => form.CancelInstall();

    public string GetInstallState() => form.CurrentInstallState;

    public string GetDefaultInstallDir() => SetupForm.DefaultInstallDir();

    public void LaunchApp() => form.LaunchApp();
}
