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
        // Install and uninstall share a mutex: neither may mutate component
        // pointers or registration while the other operation is running.
        var uninstallMode = SetupForm.IsUninstallMode(args);
        var mutexName = "ZhiYuanAgentSetup-" + InstallerEngine.AppGuid;
        var mutex = new Mutex(initiallyOwned: true, name: mutexName, out var createdNew);
        if (!createdNew)
        {
            try { mutex.Dispose(); } catch { }
            if (SetupArguments.IsSilent(args))
            {
                Environment.ExitCode = 1;
                return;
            }
            SetupForm.ActivateExistingWindow(uninstallMode);
            return;
        }
        try
        {
            // Silent uninstall runs headless: no window, no WebView2, engine
            // events mirrored to the same JSONL log the UI path writes.
            // Unknown arguments are ignored everywhere (ARP passes /S,
            // --updated, etc.).
            if (SetupArguments.IsSilent(args))
            {
                Environment.ExitCode = uninstallMode
                    ? SetupForm.RunSilentUninstall(args)
                    : SetupForm.RunSilentInstall(args);
                return;
            }
            Application.Run(new SetupForm(args));
        }
        finally
        {
            try { mutex.ReleaseMutex(); } catch { /* already released */ }
            mutex.Dispose();
        }
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

    private CancellationTokenSource installCts = new();
    private bool operationActive;
    private bool closeRequested;
    private bool launchStarted;
    private bool completedUpgrade;
    private readonly string webViewDataDir = Path.Combine(Path.GetTempPath(), "zy-webview-" + Guid.NewGuid().ToString("n"));
    private string? materializedUiDir;
    private readonly Uri uiUri;
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
    private const int SW_RESTORE = 9;

    [DllImport("user32.dll")]
    private static extern IntPtr FindWindow(string? className, string? windowName);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindow(IntPtr hWnd, int command);

    /// <summary>Second-instance handoff: bring the running shell window to the
    /// front (the window title is unique per mode and set in the ctor).</summary>
    public static void ActivateExistingWindow(bool uninstallMode)
    {
        var title = uninstallMode ? "知远智能体 卸载程序" : "知远智能体 安装程序";
        var handle = FindWindow(null, title);
        if (handle == IntPtr.Zero) return;
        ShowWindow(handle, SW_RESTORE);
        SetForegroundWindow(handle);
    }

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
        forcedInstallDir = SetupArguments.InstallDirectory(args);
        runtimeRootOverride = ValueAfter(args, "--runtime-root");
        appDataRootOverride = ValueAfter(args, "--app-data-root");
        skipCleanupOf = ValueAfter(args, "--skip-cleanup-of");
        eventsLogPath = SetupArguments.EventsLogPath(args);

        Text = uninstallMode ? "知远智能体 卸载程序" : "知远智能体 安装程序";
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        ClientSize = new Size(WindowWidth, WindowHeight);
        BackColor = Color.White;
        ShowInTaskbar = true;
        MaximizeBox = false;

        webView.Dock = DockStyle.Fill;
        webView.DefaultBackgroundColor = Color.White;
        webView.CoreWebView2InitializationCompleted += OnWebViewReady;
        webView.WebMessageReceived += OnWebMessage;
        webView.NavigationCompleted += async (_, e) =>
        {
            DebugLog($"navigation completed: IsSuccess={e.IsSuccess} WebErrorStatus={e.WebErrorStatus} Uri={webView.Source}");
            if (!e.IsSuccess)
            {
                Environment.ExitCode = 1;
                OnEngineEvent(new EngineEvent(Type: "ui-error", Message: "安装界面无法加载，请重新下载安装程序。", Detail: e.WebErrorStatus.ToString()));
                MessageBox.Show(this, "安装界面无法加载，请重新下载安装程序。\nSetup could not load its interface. Download the complete installer and try again.", Text, MessageBoxButtons.OK, MessageBoxIcon.Error);
                BeginInvoke(Close);
                return;
            }
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
                bridge.StartInstall(forcedInstallDir ?? InstallerEngine.FindExistingInstallLocation() ?? DefaultInstallDir(), false);
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

        FormClosing += (_, e) =>
        {
            if (!operationActive) return;
            e.Cancel = true;
            closeRequested = true;
            installCts.Cancel();
            OnEngineEvent(new EngineEvent(Type: "phase", Label: "正在安全结束，请稍候"));
        };
        FormClosed += (_, _) =>
        {
            webView.Dispose();
            installCts.Dispose();
            foreach (var dir in new[] { materializedUiDir, webViewDataDir })
                if (dir is not null)
                    try { InstallDirectoryTransaction.DeleteTreeWithoutFollowingLinks(dir); } catch { }
        };

        Load += async (_, _) =>
        {
            DebugLog("form load; ensuring CoreWebView2");
            try
            {
                var port = SetupArguments.AcceptanceDebugPort(args);
                var browserOptions = new CoreWebView2EnvironmentOptions();
                string? browserExecutableFolder = null;
                if (port is not null)
                {
                    browserOptions.AdditionalBrowserArguments = $"--remote-debugging-address=127.0.0.1 --remote-debugging-port={port.Value}";
                    browserExecutableFolder = ValueAfter(args, "--webview2-runtime-path");
                }
                var environment = await CoreWebView2Environment.CreateAsync(browserExecutableFolder, webViewDataDir, browserOptions);
                await webView.EnsureCoreWebView2Async(environment);
                webView.Source = uiUri;
                DebugLog("CoreWebView2 ready");
            }
            catch (Exception ex)
            {
                DebugLog($"EnsureCoreWebView2 failed: {ex}");
                Environment.ExitCode = 1;
                OnEngineEvent(new EngineEvent(Type: "webview2-error", Message: "Microsoft Edge WebView2 Runtime 无法加载", Detail: ex.GetType().Name));
                // Without the runtime the page never renders and the user would
                // stare at a blank window — say exactly what is missing.
                var chinese = System.Globalization.CultureInfo.CurrentUICulture.Name.StartsWith("zh", StringComparison.OrdinalIgnoreCase);
                MessageBox.Show(
                    this,
                    chinese
                        ? "无法加载 Microsoft Edge WebView2 运行环境，安装界面无法显示。\n\n知远智能体需要 WebView2 Runtime，请从微软官网安装后重新运行安装程序：\nhttps://developer.microsoft.com/microsoft-edge/webview2/"
                        : "Microsoft Edge WebView2 Runtime is required to show the setup UI but could not be loaded.\n\nInstall Microsoft Edge WebView2 Runtime from Microsoft and run the setup again:\nhttps://developer.microsoft.com/microsoft-edge/webview2/",
                    chinese ? "知远智能体 安装程序" : "ZhiYuan Agent Setup",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                BeginInvoke(Close);
                return;
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
        uiUri = uri.Uri;
    }

    private ShellBridge bridge = null!;

    public string CurrentInstallState => installState;

    internal string GetPreferredInstallDir() => forcedInstallDir ??
        InstallerEngine.FindExistingInstallLocation() ?? DefaultInstallDir();

    public static string DefaultInstallDir()
    {
        var localPrograms = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs");
        // Must match the NSIS APP_FILENAME (package.json `name`): both
        // installers default to the same directory.
        return Path.Combine(localPrograms, "zhiyuan-agent");
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
        var forced = SetupArguments.InstallDirectory(args);
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
        var eventsLogPath = SetupArguments.EventsLogPath(args);
        var errorReported = false;
        var progress = new InlineProgress(evt =>
        {
            if (evt.Type == "error") errorReported = true;
            AppendEvent(eventsLogPath, evt);
        });
        try
        {
            var engine = new UninstallerEngine(
                UninstallInstallDir(args),
                ValueAfter(args, "--runtime-root"),
                ValueAfter(args, "--app-data-root"),
                ValueAfter(args, "--skip-cleanup-of"), progress);
            engine.UninstallAsync(CancellationToken.None).GetAwaiter().GetResult();
            return 0;
        }
        catch (Exception ex)
        {
            if (!errorReported)
                AppendEvent(eventsLogPath, new EngineEvent(Type: "error", Message: ex.Message, Detail: ex.GetType().Name));
            return 1;
        }
    }

    public static int RunSilentInstall(string[] args)
    {
        var logPath = SetupArguments.EventsLogPath(args);
        var errorReported = false;
        var progress = new InlineProgress(evt =>
        {
            if (evt.Type == "error") errorReported = true;
            AppendEvent(logPath, evt);
        });
        try
        {
            var engine = new InstallerEngine(ValueAfter(args, "--payload"),
                SetupArguments.InstallDirectory(args) ?? InstallerEngine.FindExistingInstallLocation() ?? DefaultInstallDir(),
                ValueAfter(args, "--runtime-root"), ValueAfter(args, "--app-data-root"),
                !args.Contains("--skip-registration"), progress);
            engine.RunAsync(false, CancellationToken.None).GetAwaiter().GetResult();
            return 0;
        }
        catch (Exception ex)
        {
            if (!errorReported)
                AppendEvent(logPath, new EngineEvent(Type: "error", Message: ex.Message, Detail: ex.GetType().Name));
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

    private string ResolveUiPath(string[] args)
    {
        var flagsWithValue = new HashSet<string> { "--capture-preview", "--capture-delay", "--ui-query", "--payload", "--install-dir", "--runtime-root", "--app-data-root", "--skip-cleanup-of", "--events-log", "--acceptance-debug-port", "--webview2-runtime-path" };
        for (var i = 0; i < args.Length; i++)
        {
            if (args[i].StartsWith('-') || args[i].StartsWith('/') || args[i].StartsWith("_?=", StringComparison.Ordinal)) continue;
            if (i > 0 && flagsWithValue.Contains(args[i - 1])) continue;
            return Path.GetFullPath(args[i]);
        }
        var staged = Path.Combine(AppContext.BaseDirectory, "ui", "index.html");
        if (File.Exists(staged)) return staged;
        // Single-file SFX: no sidecar ui/ directory — materialize the embedded
        // page and brand assets into a temp dir for this process.
        var uiDir = Path.Combine(Path.GetTempPath(), "zhiyuan-setup-ui-" + Guid.NewGuid().ToString("n"));
        materializedUiDir = uiDir;
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
        if (evt.Type == "done") { installState = "done"; lastLaunchPath = evt.LaunchPath; completedUpgrade = evt.IsUpgrade == true; }
        else if (evt.Type == "error") { installState = "error"; }
        var json = evt.ToJson();
        try
        {
            AppendEvent(eventsLogPath, evt);
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
        var trustedPath = uiUri.LocalPath;
        webView.CoreWebView2.NavigationStarting += (_, navigation) =>
        {
            if (!Uri.TryCreate(navigation.Uri, UriKind.Absolute, out var target) || !target.IsFile ||
                !string.Equals(target.LocalPath, trustedPath, StringComparison.OrdinalIgnoreCase)) navigation.Cancel = true;
        };
        webView.CoreWebView2.NewWindowRequested += (_, navigation) => navigation.Handled = true;
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        var message = e.WebMessageAsJson;
        DebugLog($"web message: {message}");
        string? messageType;
        try
        {
            using var parsed = System.Text.Json.JsonDocument.Parse(message);
            if (!parsed.RootElement.TryGetProperty("type", out var type)) return;
            messageType = type.GetString();
        }
        catch (Exception ex) when (ex is System.Text.Json.JsonException or InvalidOperationException) { return; }
        if (messageType == "drag")
        {
            BeginInvoke(() =>
            {
                ReleaseCapture();
                SendMessage(Handle, WM_NCLBUTTONDOWN, HTCAPTION, 0);
            });
        }
        else if (messageType == "close")
        {
            BeginInvoke(Close);
        }
    }

    internal void StartInstall(string engineInstallDir, bool localInference)
    {
        if (InvokeRequired) { BeginInvoke(() => StartInstall(engineInstallDir, localInference)); return; }
        if (operationActive || uninstallMode || installState == "done") return;
        installCts.Dispose();
        installCts = new CancellationTokenSource();
        operationActive = true;
        installState = "installing";
        var core = webView.CoreWebView2;
        if (core is not null)
        {
            try { BeginInvoke(() => core.PostWebMessageAsJson("{\"type\":\"install-started\"}")); } catch { }
        }
        // The engine pins its install dir at construction, so build it here
        // from the page-supplied path: a Browse-confirmed directory takes
        // effect exactly as displayed on the hero page.
        var errorReported = false;
        var progress = new InlineProgress(evt =>
        {
            if (evt.Type == "error") errorReported = true;
            BeginInvoke(() => OnEngineEvent(evt));
        });
        _ = Task.Run(async () =>
        {
            try
            {
                var runEngine = new InstallerEngine(payloadDir, engineInstallDir,
                    runtimeRootOverride, appDataRootOverride, !skipRegistration, progress);
                await runEngine.RunAsync(localInference, installCts.Token);
            }
            catch (Exception ex)
            {
                // Constructor/path failures happen before the engine can report.
                if (!errorReported)
                    progress.Report(new EngineEvent(Type: "error", Message: ex.Message, Detail: ex.GetType().Name));
            }
            finally { BeginInvoke(FinishOperation); }
        });
    }

    private void FinishOperation()
    {
        operationActive = false;
        if (closeRequested) Close();
    }

    internal void CancelInstall() => installCts.Cancel();

    /// <summary>Native folder picker behind the hero page's 「更改…」: returns
    /// the confirmed directory, or null when the user cancels. Runs on the UI
    /// thread because host-object calls arrive on a WebView2 worker thread.</summary>
    internal string? BrowseInstallDir(string currentPath)
    {
        if (IsDisposed) return null;
        return (string?)Invoke(new Func<string?>(() =>
        {
            using var dialog = new FolderBrowserDialog
            {
                SelectedPath = currentPath,
                Description = "选择安装目录",
            };
            return dialog.ShowDialog(this) == DialogResult.OK ? dialog.SelectedPath : null;
        }));
    }

    internal void StartUninstall()
    {
        if (InvokeRequired) { BeginInvoke(StartUninstall); return; }
        if (operationActive || !uninstallMode || installState == "done") return;
        installCts.Dispose();
        installCts = new CancellationTokenSource();
        operationActive = true;
        installState = "uninstalling";
        var core = webView.CoreWebView2;
        if (core is not null)
        {
            try { BeginInvoke(() => core.PostWebMessageAsJson("{\"type\":\"uninstall-started\"}")); } catch { }
        }
        var errorReported = false;
        var progress = new InlineProgress(evt =>
        {
            if (evt.Type == "error") errorReported = true;
            BeginInvoke(() => OnEngineEvent(evt));
        });
        _ = Task.Run(async () =>
        {
            try
            {
                var uninstaller = new UninstallerEngine(UninstallInstallDir(rawArgs),
                    runtimeRootOverride, appDataRootOverride, skipCleanupOf, progress);
                await uninstaller.UninstallAsync(installCts.Token);
            }
            catch (Exception ex)
            {
                if (!errorReported)
                    progress.Report(new EngineEvent(Type: "error", Message: ex.Message, Detail: ex.GetType().Name));
            }
            finally { BeginInvoke(FinishOperation); }
        });
    }

    internal bool LaunchApp()
    {
        if (InvokeRequired) return (bool)Invoke(new Func<bool>(LaunchApp));
        if (launchStarted) return true;
        if (installState != "done" || uninstallMode) return false;
        try
        {
            if (lastLaunchPath is null || !File.Exists(lastLaunchPath))
                throw new FileNotFoundException("Installed application executable is missing");
            using var launched = Process.Start(new ProcessStartInfo
            {
                FileName = lastLaunchPath,
                WorkingDirectory = Path.GetDirectoryName(lastLaunchPath)!,
                Arguments = completedUpgrade ? "--updated" : string.Empty,
                UseShellExecute = false,
            });
            if (launched is null) throw new InvalidOperationException("Application did not start");
            launchStarted = true;
            OnEngineEvent(new EngineEvent(Type: "launched", LaunchPath: lastLaunchPath));
            return true;
        }
        catch (Exception ex)
        {
            DebugLog($"launch failed: {ex}");
            OnEngineEvent(new EngineEvent(Type: "launch-error", Message: "无法启动应用，请重试，或关闭安装程序后从开始菜单打开。", Detail: ex.GetType().Name));
            return false;
        }
    }

    internal string GetLicenseText()
    {
        using var resource = typeof(SetupForm).Assembly.GetManifestResourceStream("ui.license")
            ?? throw new InvalidOperationException("Embedded license is missing");
        using var reader = new StreamReader(resource);
        return reader.ReadToEnd();
    }

    private static void AppendEvent(string path, EngineEvent evt)
    {
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.AppendAllText(path, evt.ToJson() + Environment.NewLine);
        }
        catch { /* diagnostics only */ }
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

    public void StartInstall(string installPath, bool localInference) => form.StartInstall(installPath, localInference);

    public void StartUninstall() => form.StartUninstall();

    public void CancelInstall() => form.CancelInstall();

    public string GetInstallState() => form.CurrentInstallState;

    public string GetDefaultInstallDir() => form.GetPreferredInstallDir();

    public string? BrowseInstallDir(string currentPath) => form.BrowseInstallDir(currentPath);

    public bool LaunchApp() => form.LaunchApp();

    public string GetLicenseText() => form.GetLicenseText();
}
