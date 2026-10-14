using System.Diagnostics;
using Microsoft.Win32;

namespace ZhiYuan.Setup.Shell;

/// <summary>
/// Real uninstall engine for the WebView2 shell, mirroring the electron-builder
/// NSIS semantics (deleteAppDataOnUninstall: true) plus the shared
/// scripts/installer/uninstall-cleanup.ps1 detach logic that
/// scripts/nsis-installer.nsh !macro customUnInstall -File-invokes. Sequence:
/// stop processes → shared cleanup script (junctions + runtime cache detach) →
/// start-menu shortcut + registry keys → app data root → install directory
/// (via a detached cmd retry loop, the same "start /b rd" trick the NSIS
/// uninstaller uses, so the still-running uninstaller exe is picked up once
/// this process exits) → done.
/// </summary>
public sealed class UninstallerEngine
{
    private readonly string installDir;
    private readonly string runtimeRoot;
    private readonly string appDataRoot;
    private readonly HashSet<string> skipCleanup;
    private readonly IProgress<EngineEvent> progress;

    public UninstallerEngine(
        string installDir,
        string? runtimeRootOverride,
        string? appDataRootOverride,
        string? skipCleanupOf,
        IProgress<EngineEvent> progress)
    {
        this.installDir = Path.GetFullPath(installDir);
        this.progress = progress;
        appDataRoot = appDataRootOverride is null
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ZhiYuanAgent")
            : Path.GetFullPath(appDataRootOverride);
        runtimeRoot = runtimeRootOverride is null
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ZhiYuanAgent", "runtimes")
            : Path.GetFullPath(runtimeRootOverride);
        skipCleanup = new HashSet<string>(
            (skipCleanupOf ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
            StringComparer.OrdinalIgnoreCase);
    }

    public async Task UninstallAsync(CancellationToken cancellationToken)
    {
        try
        {
            await StepStopAppProcesses(cancellationToken);
            await StepCleanupRuntimeCaches(cancellationToken);
            StepRemoveShortcutAndRegistry();
            StepRemoveAppData();
            await StepRemoveInstallDirAsync(cancellationToken);
            progress.Report(new EngineEvent(Type: "done", InstallDir: installDir));
        }
        catch (OperationCanceledException)
        {
            progress.Report(new EngineEvent(
                Type: "error", Message: "卸载已取消", Detail: "cancelled by user"));
            throw;
        }
        catch (Exception ex) when (ex is EngineException or IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            progress.Report(new EngineEvent(
                Type: "error", Message: ex.Message, Detail: (ex as EngineException)?.Detail ?? ex.GetType().Name));
            throw;
        }
        catch (Exception ex)
        {
            // Catch-all mirroring the install engine: any unexpected failure
            // still lands on the failure UI instead of a stuck progress page.
            progress.Report(new EngineEvent(
                Type: "error", Message: ex.Message, Detail: ex.GetType().Name));
            throw;
        }
    }

    /// <summary>Same kill-by-install-root-path-prefix rule as the install
    /// engine, so orphaned sidecars cannot hold files in the tree being
    /// deleted. Waits up to ~10s for handles to release.</summary>
    private async Task StepStopAppProcesses(CancellationToken ct)
    {
        ReportPhase("正在停止运行中的知远进程");
        for (var attempt = 0; attempt < 21; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            var targets = FindInstallRootProcesses().ToList();
            if (targets.Count == 0) return;
            foreach (var proc in targets)
            {
                try { proc.Kill(); } catch { /* already exited or access denied */ }
            }
            if (attempt > 0) await Task.Delay(500, ct);
        }
        throw new EngineException("检测到知远进程仍在运行，且无法自动关闭。");
    }

    private IEnumerable<Process> FindInstallRootProcesses()
    {
        // The match root must be a real application directory: at a drive
        // root the prefix match would target every process on the machine.
        // TrimEnd + trailing separator also keeps sibling directories whose
        // names merely share a prefix (…\app vs …\app-other) from matching.
        var roots = new[] { installDir, runtimeRoot }
            .Where(root => !string.IsNullOrWhiteSpace(root))
            .Select(root => root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
            .Where(trimmed => trimmed.Length > 4 && !(trimmed.Length == 2 && trimmed[1] == ':'))
            .Select(trimmed => trimmed + Path.DirectorySeparatorChar)
            .ToArray();
        if (roots.Length == 0) yield break;
        foreach (var proc in Process.GetProcesses())
        {
            string? path = null;
            try { path = proc.MainModule?.FileName; } catch { /* access denied */ }
            if (path is null || proc.Id == Environment.ProcessId) continue;
            if (roots.Any(r => path.StartsWith(r, StringComparison.CurrentCultureIgnoreCase)))
            {
                yield return proc;
            }
        }
    }

    /// <summary>The shared cleanup script staged next to the app by the
    /// installer: removes resources junctions, then atomically detaches the
    /// offline runtime caches and reclaims them in the background. NSIS ignores
    /// its exit code; this side matches that forgiving shape.</summary>
    private async Task StepCleanupRuntimeCaches(CancellationToken ct)
    {
        if (skipCleanup.Contains("runtime"))
        {
            ReportPhase("已跳过离线运行环境清理");
            return;
        }
        ReportPhase("正在清理本地离线运行环境");
        var script = Path.Combine(installDir, "scripts", "uninstall-cleanup.ps1");
        if (!File.Exists(script))
        {
            progress.Report(new EngineEvent(
                Type: "phase", Label: "未找到卸载清理脚本，已跳过运行环境清理"));
            return;
        }
        await ShellProcessRunner.RunAsync(
            "powershell.exe",
            $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{script}\" " +
                $"-InstallDir \"{installDir}\" -RuntimeRoot \"{runtimeRoot}\"",
            ct,
            failureMessage: null);
        progress.Report(new EngineEvent(Type: "progress", Percent: 40));
    }

    /// <summary>The start-menu and desktop shortcuts (the ones the installer
    /// creates) plus both HKCU registration keys, in the exact shape
    /// electron-updater reads.</summary>
    private void StepRemoveShortcutAndRegistry()
    {
        ReportPhase("正在移除卸载信息");
        if (!skipCleanup.Contains("shortcuts"))
        {
            foreach (var folder in new[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
            })
            {
                var linkPath = Path.Combine(folder, InstallerEngine.DisplayName + ".lnk");
                if (File.Exists(linkPath))
                {
                    try { File.Delete(linkPath); } catch { /* a pinned copy must not block uninstall */ }
                }
            }
        }
        if (!skipCleanup.Contains("registry"))
        {
            Registry.CurrentUser.DeleteSubKeyTree(InstallerEngine.InstallRegistryKey, throwOnMissingSubKey: false);
            Registry.CurrentUser.DeleteSubKeyTree(InstallerEngine.UninstallRegistryKey, throwOnMissingSubKey: false);
        }
        progress.Report(new EngineEvent(Type: "progress", Percent: 60));
    }

    /// <summary>deleteAppDataOnUninstall: true — the whole %APPDATA%\ZhiYuanAgent
    /// tree (sessions, memory projection, pending markers) goes away.</summary>
    private void StepRemoveAppData()
    {
        ReportPhase("正在删除个人数据");
        if (skipCleanup.Contains("app-data")) return;
        if (Directory.Exists(appDataRoot))
        {
            Directory.Delete(appDataRoot, recursive: true);
        }
        progress.Report(new EngineEvent(Type: "progress", Percent: 80));
    }

    /// <summary>The install directory still contains this running uninstaller,
    /// so a direct recursive delete would fail. Hand the tree to a detached
    /// cmd retry loop working from %TEMP% — the same "start /b rd" trick the
    /// NSIS uninstaller uses: rd fails while we are alive, succeeds the moment
    /// this process exits, and never blocks the done event.</summary>
    private Task StepRemoveInstallDirAsync(CancellationToken ct)
    {
        ReportPhase("正在删除安装目录");
        ct.ThrowIfCancellationRequested();
        if (skipCleanup.Contains("install-dir") || !Directory.Exists(installDir))
        {
            return Task.CompletedTask;
        }
        var retryLoop =
            $"for /l %i in (1,1,60) do @(rd /s /q \"{installDir}\" >nul 2>&1 & " +
            $"if not exist \"{installDir}\" exit /b 0 & ping -n 2 127.0.0.1 >nul)";
        var startInfo = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c start \"\" /b cmd /d /c \"{retryLoop}\"",
            WorkingDirectory = Path.GetTempPath(),
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using var detached = Process.Start(startInfo);
        if (detached is null) throw new InvalidOperationException("failed to spawn the install-directory cleanup");
        progress.Report(new EngineEvent(Type: "progress", Percent: 100));
        return Task.CompletedTask;
    }

    private void ReportPhase(string label) => progress.Report(new EngineEvent(Type: "phase", Label: label));
}
