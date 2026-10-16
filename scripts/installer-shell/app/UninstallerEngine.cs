using System.Diagnostics;
using Microsoft.Win32;

namespace ZhiYuan.Setup.Shell;

/// <summary>
/// Real uninstall engine for the WebView2 shell, mirroring the electron-builder
/// NSIS application cleanup semantics plus the shared
/// scripts/installer/uninstall-cleanup.ps1 detach logic that
/// scripts/nsis-installer.nsh !macro customUnInstall -File-invokes. Sequence:
/// stop processes → shared cleanup script (junctions + runtime cache detach) →
/// start-menu shortcut + registry keys → detached installation cleanup → done.
/// Personal data is always retained. Cleanup never targets the reusable install
/// path after returning to an updater, which may immediately install there.
/// </summary>
public sealed class UninstallerEngine
{
    private readonly string installDir;
    private readonly string runtimeRoot;
    private string? detachedInstallDir;
    private readonly HashSet<string> skipCleanup;
    private readonly IProgress<EngineEvent> progress;

    public UninstallerEngine(
        string installDir,
        string? runtimeRootOverride,
        string? appDataRootOverride,
        string? skipCleanupOf,
        IProgress<EngineEvent> progress)
    {
        this.installDir = Path.TrimEndingDirectorySeparator(Path.GetFullPath(installDir));
        this.progress = progress;
        var appDataRoot = appDataRootOverride is null
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ZhiYuanAgent")
            : Path.GetFullPath(appDataRootOverride);
        runtimeRoot = runtimeRootOverride is null
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ZhiYuanAgent", "runtimes")
            : Path.GetFullPath(runtimeRootOverride);
        InstallDirectoryTransaction.ValidateRoots(this.installDir, runtimeRoot, appDataRoot);
        skipCleanup = new HashSet<string>(
            (skipCleanupOf ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries),
            StringComparer.OrdinalIgnoreCase);
    }

    public async Task UninstallAsync(CancellationToken cancellationToken)
    {
        try
        {
            if (!Directory.Exists(installDir))
            {
                progress.Report(new EngineEvent(Type: "done", InstallDir: installDir));
                return;
            }
            ValidateInstallOwnership();
            await StepStopAppProcesses(cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            StepDetachInstallDirectory();
            // The destructive part cannot be meaningfully cancelled. Complete
            // cleanup after the atomic detach instead of stranding half a run.
            await StepCleanupRuntimeCaches(CancellationToken.None);
            StepRemoveShortcutAndRegistry();
            await StepRemoveInstallDirAsync(CancellationToken.None);
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
        using var deadline = CancellationTokenSource.CreateLinkedTokenSource(ct);
        deadline.CancelAfter(TimeSpan.FromSeconds(10));
        try
        {
            for (var attempt = 0; attempt < 21; attempt++)
            {
                deadline.Token.ThrowIfCancellationRequested();
                var targets = FindInstallRootProcesses().ToList();
                if (targets.Count == 0) return;
                try
                {
                    foreach (var proc in targets)
                        try { proc.Kill(); } catch { /* already exited or access denied */ }
                    // Keep the captured handles until the matching processes
                    // have really exited and released their installation files.
                    await Task.WhenAll(targets.Select(proc => proc.WaitForExitAsync(deadline.Token)));
                }
                finally { foreach (var proc in targets) proc.Dispose(); }
                if (attempt > 0) await Task.Delay(500, deadline.Token);
            }
        }
        catch (OperationCanceledException) when (!ct.IsCancellationRequested) { /* bounded stop timed out */ }
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
            try { _ = proc.Handle; path = proc.MainModule?.FileName; } catch { /* exited or access denied */ }
            if (path is null || proc.Id == Environment.ProcessId) { proc.Dispose(); continue; }
            if (roots.Any(r => path.StartsWith(r, StringComparison.OrdinalIgnoreCase)))
            {
                yield return proc;
            }
            else proc.Dispose();
        }
    }

    private void StepDetachInstallDirectory()
    {
        if (skipCleanup.Contains("install-dir") || !Directory.Exists(installDir)) return;
        ValidateInstallOwnership();
        ReportPhase("正在移除应用程序，个人数据将保留");
        Environment.CurrentDirectory = Path.GetTempPath();
        var target = installDir + ".uninstall." + Guid.NewGuid().ToString("n");
        try { Directory.Move(installDir, target); }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            throw new EngineException("安装目录仍被占用，请关闭相关程序后重试卸载。", ex.GetType().Name);
        }
        detachedInstallDir = target;
    }

    private void ValidateInstallOwnership()
    {
        new InstallDirectoryTransaction(installDir).ValidateOwnership(requireInstalled: true);
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
        var cleanupRoot = detachedInstallDir ?? installDir;
        var script = Path.Combine(cleanupRoot, "scripts", "uninstall-cleanup.ps1");
        if (!File.Exists(script))
        {
            progress.Report(new EngineEvent(
                Type: "phase", Label: "未找到卸载清理脚本，已跳过运行环境清理"));
            return;
        }
        await ShellProcessRunner.RunPowerShellAsync(
            script,
            $"-InstallDir \"{cleanupRoot}\" -RuntimeRoot \"{runtimeRoot}\"",
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

    /// <summary>The renamed directory can still contain the running host.
    /// Retry removal of that detached tree only; a newer installation may
    /// already be using the original path when the host finally exits.</summary>
    private Task StepRemoveInstallDirAsync(CancellationToken ct)
    {
        ReportPhase("正在删除安装目录");
        ct.ThrowIfCancellationRequested();
        if (detachedInstallDir is null || !Directory.Exists(detachedInstallDir))
        {
            return Task.CompletedTask;
        }
        // Paths are inherited as data, never interpolated into cmd syntax.
        // Remove links themselves rather than traversing external user files.
        var cleanup = "Wait-Process -Id ([int]$env:ZY_UNINSTALL_PID) -ErrorAction SilentlyContinue; " +
            "function Remove-Tree([string]$p) { " +
            "if (-not (Test-Path -LiteralPath $p)) { return }; " +
            "$item=Get-Item -LiteralPath $p -Force; " +
            "if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { [IO.Directory]::Delete($p); return }; " +
            "Get-ChildItem -LiteralPath $p -Force | ForEach-Object { " +
            "if ($_.PSIsContainer) { Remove-Tree $_.FullName } else { Remove-Item -LiteralPath $_.FullName -Force -ErrorAction Stop } }; " +
            "[IO.Directory]::Delete($p) }; " +
            "for ($i=0; $i -lt 60; $i++) { try { Remove-Tree $env:ZY_UNINSTALL_TREE; break } catch { Start-Sleep -Seconds 1 } }";
        var encoded = Convert.ToBase64String(System.Text.Encoding.Unicode.GetBytes(cleanup));
        var startInfo = ShellProcessRunner.CreatePowerShellStartInfo(
            $"-NoProfile -NonInteractive -WindowStyle Hidden -EncodedCommand {encoded}");
        startInfo.WorkingDirectory = Path.GetTempPath();
        startInfo.Environment["ZY_UNINSTALL_TREE"] = detachedInstallDir;
        startInfo.Environment["ZY_UNINSTALL_PID"] = Environment.ProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        using var detached = Process.Start(startInfo);
        if (detached is null) throw new InvalidOperationException("failed to spawn the install-directory cleanup");
        progress.Report(new EngineEvent(Type: "progress", Percent: 100));
        return Task.CompletedTask;
    }

    private void ReportPhase(string label) => progress.Report(new EngineEvent(Type: "phase", Label: label));
}
