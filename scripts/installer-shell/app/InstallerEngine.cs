using System.Text.Json;
using System.Diagnostics;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace ZhiYuan.Setup.Shell;

/// <summary>
/// JSON shape pushed to the page (see docs/2026-10-12-windows-installer-webview2-shell.zh-CN.md):
/// {"type":"phase","label":...} / {"type":"progress","percent","bytesDone","bytesTotal"} /
/// {"type":"done","installDir","launchPath"} / {"type":"error","message","detail"}.
/// </summary>
public sealed record EngineEvent(
    string Type,
    string? Label = null,
    int? Percent = null,
    long? BytesDone = null,
    long? BytesTotal = null,
    string? InstallDir = null,
    string? LaunchPath = null,
    string? Message = null,
    string? Detail = null,
    bool? IsUpgrade = null)
{
    public string ToJson() => JsonSerializer.Serialize(this, EngineJsonContext.Default.EngineEvent);
}

[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
[JsonSerializable(typeof(EngineEvent))]
internal partial class EngineJsonContext : JsonSerializerContext;

public sealed class EngineException : Exception
{
    public EngineException(string message, string? detail = null) : base(message) => Detail = detail;

    public string? Detail { get; }
}

/// <summary>
/// Real install engine for the WebView2 shell. Orchestrates the installation
/// sequence of scripts/nsis-installer.nsh customInit/customInstall semantics;
/// component logic itself lives in the shared scripts under scripts/installer
/// (the same files the NSIS installer -File-invokes), so both installers
/// produce the same on-disk shape: junctions under &lt;install&gt;\resources
/// pointing into the content-addressed cache in %LOCALAPPDATA%\ZhiYuanAgent\runtimes.
/// </summary>
public sealed class InstallerEngine
{
    // UUIDv5("com.zhiyuanagent.app", ns=50e065bc-3134-11e6-9bab-38c9862bdaf3) —
    // identical to the GUID electron-builder derives for the NSIS installer,
    // so both installers register/unregister the same keys.
    public const string AppGuid = "331369f7-5ab3-5702-935d-f3cff6ba8163";
    public const string AppExeName = "知远.exe";
    public const string DisplayName = "知远智能体 (ZhiYuan Agent)";
    public const string Publisher = "知远智能体 (ZhiYuan Agent)";

    internal static readonly string InstallRegistryKey = $@"Software\{AppGuid}";
    internal static readonly string UninstallRegistryKey =
        $@"Software\Microsoft\Windows\CurrentVersion\Uninstall\{AppGuid}";

    /// <summary>The NSIS installer records InstallLocation under this key. An
    /// existing value means this machine already has an installation (possibly
    /// per-machine in HKLM), so a shell install into the same directory is an
    /// upgrade instead of a second copy that would orphan the old one.</summary>
    internal static string? FindExistingInstallLocation()
    {
        using (var hkcu = RegistryKey.OpenBaseKey(RegistryHive.CurrentUser, RegistryView.Registry64))
        {
            var userLocation = ReadInstallLocation(hkcu);
            if (userLocation is not null) return userLocation;
        }
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            using var hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view);
            var machineLocation = ReadInstallLocation(hklm);
            if (machineLocation is not null) return machineLocation;
        }
        return null;
    }

    private static string? ReadInstallLocation(RegistryKey hive)
    {
        using var key = hive.OpenSubKey(InstallRegistryKey);
        if (key?.GetValue("InstallLocation") is not string value || string.IsNullOrWhiteSpace(value))
        {
            return null;
        }
        try
        {
            var fullPath = Path.GetFullPath(value);
            return Directory.Exists(fullPath) ? fullPath : null;
        }
        catch
        {
            return null;
        }
    }

    private readonly string? payloadDirArg;
    private string? payloadDir;
    private readonly string workDir;
    private readonly string installDir;
    private readonly string runtimeRoot;
    private readonly string appDataRoot;
    private readonly bool registerInstall;
    private readonly IProgress<EngineEvent> progress;

    private string ScriptsDir => Path.Combine(payloadDir!, "scripts");
    private string ComponentsDir => Path.Combine(payloadDir!, "components");
    private string SevenZipPath => Path.Combine(payloadDir!, "tools", "7za.exe");
    private string ManifestPath => Path.Combine(payloadDir!, "component-manifest.json");
    private string TargetsPath => Path.Combine(payloadDir!, "component-targets.json");

    private string? extractedPayloadDir;
    private readonly InstallDirectoryTransaction transaction;
    private bool installCommitted;
    private bool transactionOwned;
    private bool isUpgrade;
    private InstallRegistrationSnapshot? registrationSnapshot;
    private bool inferenceMarkerTouched;
    private byte[]? previousInferenceMarker;

    public InstallerEngine(
        string? payloadDir,
        string installDir,
        string? runtimeRootOverride,
        string? appDataRootOverride,
        bool registerInstall,
        IProgress<EngineEvent> progress)
    {
        payloadDirArg = payloadDir is null ? null : Path.GetFullPath(payloadDir);
        this.installDir = Path.TrimEndingDirectorySeparator(Path.GetFullPath(installDir));
        this.registerInstall = registerInstall;
        this.progress = progress;
        var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        appDataRoot = appDataRootOverride is null
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ZhiYuanAgent")
            : Path.GetFullPath(appDataRootOverride);
        runtimeRoot = runtimeRootOverride is null
            ? Path.Combine(localAppData, "ZhiYuanAgent", "runtimes")
            : Path.GetFullPath(runtimeRootOverride);
        InstallDirectoryTransaction.ValidateRoots(this.installDir, runtimeRoot, appDataRoot);
        transaction = new InstallDirectoryTransaction(this.installDir);
        workDir = Path.Combine(Path.GetTempPath(), "zy-setup-" + Guid.NewGuid().ToString("n")[..12]);
    }

    public string LaunchPath => Path.Combine(installDir, AppExeName);

    public async Task RunAsync(bool localInference, CancellationToken cancellationToken)
    {
        try
        {
            transaction.ValidateOwnership();
            Directory.CreateDirectory(appDataRoot);
            Directory.CreateDirectory(runtimeRoot);
            await ResolvePayloadDirAsync(cancellationToken);
            await StepStopAppProcesses(cancellationToken);
            // Recover both halves before starting another transaction. A
            // committed journal means only housekeeping was interrupted.
            if (transaction.HasPendingState && transaction.IsCommitted)
            {
                File.Delete(Path.Combine(runtimeRoot, "component-switch-state.txt"));
                await StepCleanup(CancellationToken.None);
                transaction.Finish();
            }
            await StepRecoverComponentSwitch(cancellationToken);
            transaction.Rollback();
            await StepMigrateUserSkills(cancellationToken);
            await StepDetachPreviousInstall(cancellationToken);
            await StepExtractAppPackage(cancellationToken);
            await StepValidateComponents("cache", "正在校验离线组件", cancellationToken);
            await StepValidateComponents("expand", "正在展开离线组件", cancellationToken);
            await StepActivateComponents(cancellationToken);
            await StepLinkRuntimeJunctions(cancellationToken);
            StepVerifyRuntimeSentinels();
            await StepInstallVcRuntime(cancellationToken);
            StepWritePendingInferenceMarker(localInference);
            if (registerInstall)
            {
                registrationSnapshot = new InstallRegistrationSnapshot();
                StepRegisterUninstall();
                CreateShortcut(Environment.GetFolderPath(Environment.SpecialFolder.Programs));
                CreateShortcut(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory));
            }
            cancellationToken.ThrowIfCancellationRequested();
            transaction.MarkCommitted();
            installCommitted = true;
            // Never destroy rollback material before registry/shortcuts and
            // all mandatory validation have succeeded. Cleanup is post-commit.
            try
            {
                File.Delete(Path.Combine(runtimeRoot, "component-switch-state.txt"));
                await StepCleanup(CancellationToken.None);
                transaction.Finish();
            }
            catch (Exception ex)
            {
                progress.Report(new EngineEvent(Type: "phase", Label: "安装已完成，旧版本清理将在下次安装时重试", Detail: ex.GetType().Name));
            }
            progress.Report(new EngineEvent(Type: "done", InstallDir: installDir, LaunchPath: LaunchPath, IsUpgrade: isUpgrade));
        }
        catch (OperationCanceledException)
        {
            await RollbackAsync("安装已取消");
            progress.Report(new EngineEvent(
                Type: "error", Message: "安装已取消", Detail: "cancelled by user"));
            throw;
        }
        catch (Exception ex) when (ex is EngineException or IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            await RollbackAsync(ex.Message);
            progress.Report(new EngineEvent(
                Type: "error", Message: ex.Message, Detail: (ex as EngineException)?.Detail ?? ex.GetType().Name));
            throw;
        }
        catch (Exception ex)
        {
            // Catch-all so unexpected failures (e.g. dynamic COM exceptions from
            // shortcut creation) still reach the failure UI instead of leaving
            // the progress page stuck on "installing".
            await RollbackAsync(ex.Message);
            progress.Report(new EngineEvent(
                Type: "error", Message: ex.Message, Detail: ex.GetType().Name));
            throw;
        }
        finally
        {
            // The self-extracted payload is scratch space: delete it on every
            // exit path, including failures and cancellation.
            if (extractedPayloadDir is not null && Directory.Exists(extractedPayloadDir))
            {
                try { Directory.Delete(extractedPayloadDir, recursive: true); }
                catch { /* a locked file must not mask the install outcome */ }
            }
            // workDir is per-run scratch (staged components, elevated-action
            // results); the finally block removes it on every exit path —
            // success, failure and cancellation alike — so no %TEMP%\zy-setup-*
            // directory leaks. (RollbackAsync also tries; the finally here is
            // the authoritative cleanup.)
            try { if (Directory.Exists(workDir)) Directory.Delete(workDir, recursive: true); }
            catch { /* diagnostics are best-effort */ }
        }
    }

    /// <summary>Extract the bounded ZYP2 payload located before the optional
    /// Authenticode certificate table. Signature bytes are never ZIP data.</summary>
    private async Task ResolvePayloadDirAsync(CancellationToken ct)
    {
        if (payloadDirArg is not null)
        {
            payloadDir = payloadDirArg;
            return;
        }
        var exePath = Environment.ProcessPath
            ?? throw new EngineException("无法定位安装程序自身路径");
        await using var fileStream = new FileStream(exePath, FileMode.Open, FileAccess.Read, FileShare.Read);
        var (zipStart, zipSize) = SfxPayload.Locate(fileStream);

        progress.Report(new EngineEvent(Type: "phase", Label: "正在准备安装包"));
        var extractRoot = Path.GetTempPath();
        var extractDir = Path.GetFullPath(Path.Combine(extractRoot, "zhiyuan-setup-" + Guid.NewGuid().ToString("n")));
        Directory.CreateDirectory(extractDir);
        extractedPayloadDir = extractDir;

        fileStream.Seek(zipStart, SeekOrigin.Begin);
        using var zip = new System.IO.Compression.ZipArchive(
            new OffsetStream(fileStream, zipSize), System.IO.Compression.ZipArchiveMode.Read);
        var totalBytes = zip.Entries.Sum(entry => entry.Length);
        long doneBytes = 0;
        foreach (var entry in zip.Entries)
        {
            ct.ThrowIfCancellationRequested();
            // Zip-slip guard: the combined path must stay inside extractDir
            // (separator-terminated prefix), otherwise a crafted archive entry
            // like "../x" or an absolute name would write outside the sandbox.
            var targetPath = Path.GetFullPath(Path.Combine(extractDir, entry.FullName));
            if (!targetPath.StartsWith(extractDir + Path.DirectorySeparatorChar, StringComparison.Ordinal))
            {
                throw new EngineException("内嵌载荷包含无效路径，请重新下载安装包。");
            }
            if (entry.FullName.EndsWith("/", StringComparison.Ordinal) || entry.FullName.EndsWith("\\", StringComparison.Ordinal))
            {
                Directory.CreateDirectory(targetPath);
                continue;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(targetPath)!);
            await using var input = entry.Open();
            await using var output = new FileStream(targetPath, FileMode.Create, FileAccess.Write, FileShare.None);
            var buffer = new byte[64 * 1024];
            int read;
            while ((read = await input.ReadAsync(buffer, ct)) > 0)
            {
                await output.WriteAsync(buffer.AsMemory(0, read), ct);
                doneBytes += read;
                progress.Report(new EngineEvent(
                    Type: "progress", Percent: (int)(doneBytes * 100 / Math.Max(totalBytes, 1)),
                    BytesDone: doneBytes, BytesTotal: totalBytes));
            }
        }
        progress.Report(new EngineEvent(
            Type: "phase",
            Label: "安装包已就绪",
            Detail: extractDir));
        payloadDir = extractDir;
    }

    /// <summary>Reads exactly <paramref name="length"/> bytes from an
    /// underlying stream, hiding the zip's trailing bytes from the archive.</summary>
    private sealed class OffsetStream : System.IO.Stream
    {
        private readonly System.IO.Stream inner;
        private readonly long start;
        private readonly long length;
        private long remaining;

        public OffsetStream(System.IO.Stream inner, long length)
        {
            this.inner = inner;
            start = inner.Position;
            this.length = length;
            remaining = length;
        }

        public override bool CanRead => true;
        public override bool CanSeek => true;
        public override bool CanWrite => false;
        public override long Length => length;
        public override long Position { get => length - remaining; set => Seek(value, SeekOrigin.Begin); }
        public override void Flush() { }
        public override int Read(byte[] buffer, int offset, int count)
        {
            if (remaining <= 0) return 0;
            var read = inner.Read(buffer, offset, (int)Math.Min(count, remaining));
            remaining -= read;
            return read;
        }
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            if (remaining <= 0) return 0;
            var read = await inner.ReadAsync(buffer[..(int)Math.Min(buffer.Length, remaining)], cancellationToken);
            remaining -= read;
            return read;
        }
        public override long Seek(long offset, SeekOrigin origin)
        {
            var position = origin switch
            {
                SeekOrigin.Begin => offset,
                SeekOrigin.Current => Position + offset,
                SeekOrigin.End => length + offset,
                _ => throw new ArgumentOutOfRangeException(nameof(origin)),
            };
            if (position < 0 || position > length) throw new IOException("ZIP seek exceeds payload bounds");
            inner.Position = start + position;
            remaining = length - position;
            return position;
        }
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    }

    // ---------------------------------------------------------------- steps

    /// <summary>Step 1 — port of StopAppProcesses: kill by install-root path
    /// prefix (sidecars survive a killed main process), then wait up to 10s.</summary>
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
                using (proc) { try { proc.Kill(); } catch { /* already exited or access denied */ } }
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
            if (path is null || proc.Id == Environment.ProcessId) { proc.Dispose(); continue; }
            if (roots.Any(r => path.StartsWith(r, StringComparison.OrdinalIgnoreCase)))
            {
                yield return proc;
            }
            else proc.Dispose();
        }
    }

    /// <summary>Step 2 — port of the SKILLs migration: user-created Skills copy
    /// to %APPDATA%\ZhiYuanAgent\SKILLs, bundled entries skipped.</summary>
    private Task StepMigrateUserSkills(CancellationToken ct)
    {
        ReportPhase("正在迁移用户创建的 Skills");
        ct.ThrowIfCancellationRequested();
        var source = Path.Combine(installDir, "resources", "SKILLs");
        if (!Directory.Exists(source)) return Task.CompletedTask;
        var destination = Path.Combine(appDataRoot, "SKILLs");
        Directory.CreateDirectory(destination);
        var bundled = ReadBundledSkillNames(source);
        foreach (var dir in Directory.EnumerateDirectories(source))
        {
            ct.ThrowIfCancellationRequested();
            var name = Path.GetFileName(dir);
            if (bundled.Contains(name)) continue;
            var target = Path.Combine(destination, name);
            CopyDirectory(dir, target);
        }
        return Task.CompletedTask;
    }

    private static HashSet<string> ReadBundledSkillNames(string skillsRoot)
    {
        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var configPath = Path.Combine(skillsRoot, "skills.config.json");
        try
        {
            if (!File.Exists(configPath)) return names;
            using var doc = JsonDocument.Parse(File.ReadAllText(configPath));
            if (doc.RootElement.TryGetProperty("defaults", out var defaults))
            {
                foreach (var prop in defaults.EnumerateObject()) names.Add(prop.Name);
            }
        }
        catch { /* a broken bundled config must not block user-data migration */ }
        return names;
    }

    /// <summary>Step 3 — port of the old-install detach: rename INSTDIR away and
    /// remember the path; a failed rename is diagnosed as running app vs a
    /// directory handle held by another program (ZY_APP_UNCLOSABLE / ZY_DIR_OCCUPIED).</summary>
    private Task StepDetachPreviousInstall(CancellationToken ct)
    {
        ReportPhase("正在准备安装目录");
        ct.ThrowIfCancellationRequested();
        isUpgrade = File.Exists(LaunchPath);
        try
        {
            transactionOwned = true;
            transaction.Begin();
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            var running = FindInstallRootProcesses().Sum(proc => { proc.Dispose(); return 1; });
            var message = running > 0
                ? "检测到知远进程仍在运行，且无法自动关闭。请手动退出知远后重试。"
                : "无法更新安装目录，目录正被其他程序占用。请关闭占用该目录的窗口或程序后重试：" + installDir;
            throw new EngineException(message, $"running={running}");
        }
        if (transaction.BackupDir is not null)
            File.WriteAllText(Path.Combine(appDataRoot, "old-install-path.txt"), transaction.BackupDir);
        return Task.CompletedTask;
    }

    /// <summary>Step 4 — verify 7za against its SHA-256, then extract app.7z into
    /// the install directory, driving byte-level progress from 7za's stdout
    /// percentage lines.</summary>
    private async Task StepExtractAppPackage(CancellationToken ct)
    {
        ReportPhase("正在解包应用程序");
        VerifySevenZip();
        var archivePath = Path.Combine(payloadDir!, "app.7z");
        if (!File.Exists(archivePath)) throw new EngineException("安装包缺少应用程序归档 app.7z");
        var bytesTotal = new FileInfo(archivePath).Length;
        Directory.CreateDirectory(installDir);
        var percentRegex = new Regex(@"(\d+)%", RegexOptions.Compiled);
        var lastReported = -1;
        await ShellProcessRunner.RunAsync(
            SevenZipPath, $"x \"{archivePath}\" -o\"{installDir}\" -y -bsp1", ct,
            onOutputLine: line =>
            {
                var match = percentRegex.Match(line);
                if (!match.Success) return;
                var percent = int.Parse(match.Groups[1].Value);
                if (percent == lastReported) return;
                lastReported = percent;
                progress.Report(new EngineEvent(
                    Type: "progress", Percent: percent,
                    BytesDone: bytesTotal * percent / 100, BytesTotal: bytesTotal));
            }, failureMessage: "应用程序解包失败");
        if (!File.Exists(LaunchPath) || !File.Exists(Path.Combine(installDir, "resources", "app.asar")))
            throw new EngineException("安装包缺少必需的应用文件，请重新下载安装包。");
    }

    private void VerifySevenZip()
    {
        var hashPath = Path.Combine(payloadDir!, "tools", "7za.sha256");
        if (!File.Exists(SevenZipPath) || !File.Exists(hashPath))
            throw new EngineException("安装包缺少 7za 工具或校验信息");
        var expected = File.ReadAllText(hashPath).Trim().ToLowerInvariant();
        using var sha = System.Security.Cryptography.SHA256.Create();
        var actual = Convert.ToHexString(sha.ComputeHash(File.ReadAllBytes(SevenZipPath))).ToLowerInvariant();
        if (actual != expected) throw new EngineException("7za 校验不匹配，安装包可能已损坏。", $"expected={expected} actual={actual}");
    }

    /// <summary>Step 5 — recover an interrupted component switch from a previous
    /// run before deciding cache validity (same as the NSIS ordering).</summary>
    private async Task StepRecoverComponentSwitch(CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        await RunPowerShellAsync(
            Path.Combine(ScriptsDir, "recover-component-switch.ps1"),
            $"-RuntimeRoot \"{runtimeRoot}\"", ct,
            failureMessage: "组件状态恢复失败");
    }

    /// <summary>Steps 6/7 — the shared validator; cache mode decides which
    /// archives to stage, expand mode validates and extracts the batch.</summary>
    private async Task StepValidateComponents(string mode, string phase, CancellationToken ct)
    {
        ReportPhase(phase);
        Directory.CreateDirectory(workDir);
        var componentsDir = ComponentsDir;
        foreach (var file in Directory.EnumerateFiles(componentsDir))
        {
            ct.ThrowIfCancellationRequested();
            // Payload archives are named <key>.7z; the shared validator (and the
            // NSIS staging layout it mirrors) expects component-<key>.*.
            var name = Path.GetFileName(file);
            var stagedName = name.StartsWith("component-", StringComparison.OrdinalIgnoreCase)
                ? name
                : "component-" + name;
            File.Copy(file, Path.Combine(workDir, stagedName), overwrite: true);
        }
        await RunPowerShellAsync(
            Path.Combine(ScriptsDir, "validate-offline-components.ps1"),
            $"-Mode {mode} -PluginDir \"{workDir}\" -RuntimeRoot \"{runtimeRoot}\" " +
            $"-ComponentTargetsPath \"{TargetsPath}\" " +
            $"-SevenZipPath \"{SevenZipPath}\"", ct,
            failureMessage: mode == "cache" ? "离线组件缓存校验失败" : "离线组件展开失败");
    }

    /// <summary>Step 8 — junction switching with the state-file rollback protocol.</summary>
    private async Task StepActivateComponents(CancellationToken ct)
    {
        ReportPhase("正在激活离线组件");
        await RunPowerShellAsync(
            Path.Combine(ScriptsDir, "activate-components.ps1"),
            $"-PluginDir \"{workDir}\" -RuntimeRoot \"{runtimeRoot}\" " +
            $"-ManifestPath \"{ManifestPath}\" " +
            $"-TargetsPath \"{TargetsPath}\" " +
            $"-StatePath \"{Path.Combine(runtimeRoot, "component-switch-state.txt")}\"", ct,
            failureMessage: "离线组件切换失败");
    }

    /// <summary>Step 9 — junctions under &lt;install&gt;\resources into the cache.</summary>
    private async Task StepLinkRuntimeJunctions(CancellationToken ct)
    {
        ReportPhase("正在连接本地运行环境");
        await RunPowerShellAsync(
            Path.Combine(ScriptsDir, "link-runtime-junctions.ps1"),
            $"-ResourceRoot \"{Path.Combine(installDir, "resources")}\" -RuntimeRoot \"{runtimeRoot}\" " +
            $"-ManifestPath \"{ManifestPath}\"", ct,
            failureMessage: "离线运行环境连接失败");
    }

    /// <summary>Verify the main repository's complete component contract,
    /// including its Python, skills, channel and PortableGit entrypoints.</summary>
    private void StepVerifyRuntimeSentinels()
    {
        ReportPhase("正在校验运行环境");
        var resources = Path.Combine(installDir, "resources");
        using var targets = JsonDocument.Parse(File.ReadAllText(TargetsPath));
        if (targets.RootElement.GetArrayLength() != 7)
            throw new EngineException("安装包组件配置不完整。");
        foreach (var target in targets.RootElement.EnumerateArray())
        {
            var relative = target.GetProperty("sentinel").GetString()
                ?? throw new EngineException("安装包组件配置无效。");
            var sentinel = Path.GetFullPath(Path.Combine(resources, relative));
            if (!sentinel.StartsWith(resources + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                !File.Exists(sentinel))
                throw new EngineException("运行环境校验失败，请重新下载安装包。", relative);
        }
    }

    /// <summary>Step 11 — port of RunElevatedAction(INSTALL_VC): registry probe,
    /// then a runas helper for the bundled redistributable. Failures downgrade
    /// to a warning, matching the NSIS "知远仍会完成安装" semantics.</summary>
    private async Task StepInstallVcRuntime(CancellationToken ct)
    {
        ReportPhase("正在安装 Microsoft Visual C++ 运行时");
        ct.ThrowIfCancellationRequested();
        using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64");
        if (key?.GetValue("Installed") is int installed && installed == 1) return;
        var redist = Path.Combine(installDir, "resources", "vc_redist.x64.exe");
        if (!File.Exists(redist)) return;
        var resultPath = Path.Combine(workDir, "elevated-action-result.txt");
        var helper = Path.Combine(ScriptsDir, "elevated-actions.ps1");
        var startInfo = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"{helper}\" " +
                $"-Action install-vc-runtime -Target \"{redist}\" -ResultPath \"{resultPath}\"",
            UseShellExecute = true,
            Verb = "runas",
            WindowStyle = ProcessWindowStyle.Hidden,
        };
        int exitCode;
        try
        {
            using var elevated = Process.Start(startInfo);
            if (elevated is null) throw new InvalidOperationException("failed to start elevated helper");
            await elevated.WaitForExitAsync(ct);
            exitCode = elevated.ExitCode;
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            progress.Report(new EngineEvent(
                Type: "phase", Label: "Microsoft Visual C++ Runtime 未能自动安装，部分本地组件可能暂时不可用"));
            return;
        }
        if (exitCode is 0 or 1638 or 3010 or 1223) return;
        progress.Report(new EngineEvent(
            Type: "phase", Label: "Microsoft Visual C++ Runtime 未能自动安装，部分本地组件可能暂时不可用"));
    }

    /// <summary>Step 12 — the in-app downloader reads this marker on first launch.
    /// NSIS writes the local-inference component's content-id; the shell does not
    /// track component ids, so it writes the app's canonical fallback request id
    /// instead of an arbitrary word.</summary>
    private void StepWritePendingInferenceMarker(bool localInference)
    {
        var marker = Path.Combine(appDataRoot, "pending-local-inference-install");
        previousInferenceMarker = File.Exists(marker) ? File.ReadAllBytes(marker) : null;
        inferenceMarkerTouched = true;
        if (File.Exists(marker)) File.Delete(marker);
        if (localInference) File.WriteAllText(marker, "installer-request");
    }

    /// <summary>Step 13 — previous-version teardown plus unused component-version
    /// reclamation (shared script, same one the NSIS installer calls).</summary>
    private async Task StepCleanup(CancellationToken ct)
    {
        ReportPhase("正在清理旧版本");
        var previousInstallArgument = transaction.BackupDir is { } backup
            ? $"-OldInstallPath \"{backup}\" " : string.Empty;
        await RunPowerShellAsync(
            Path.Combine(ScriptsDir, "cleanup-after-install.ps1"),
            $"-InstallDir \"{installDir}\" -RuntimeRoot \"{runtimeRoot}\" " +
            $"-ManifestPath \"{ManifestPath}\" " +
            "-UseExactOldInstallPath " + previousInstallArgument +
            $"-OldInstallPathFile \"{Path.Combine(appDataRoot, "old-install-path.txt")}\"", ct,
            failureMessage: "旧版本清理未完成，请关闭占用旧版本目录的程序后重试");
    }

    /// <summary>Step 14 — registry keys in the exact electron-builder shape so
    /// electron-updater locates this install exactly like an NSIS one. Also
    /// ships the independently signed NSIS uninstaller produced by the same
    /// electron-builder run. Copy its exact bytes and preserve its /S quiet
    /// contract; the WebView2 host is not duplicated in the payload.</summary>
    private void StepRegisterUninstall()
    {
        ReportPhase("正在写入卸载信息");
        var uninstallExe = Path.Combine(installDir, "Uninstall " + DisplayName + ".exe");
        var uninstallerHost = Path.Combine(payloadDir!, "uninstall.exe");
        if (!File.Exists(uninstallerHost)) throw new EngineException("安装包缺少卸载程序，请重新下载安装包。");
        File.Copy(uninstallerHost, uninstallExe, overwrite: true);
        var cleanupScript = Path.Combine(payloadDir!, "scripts", "uninstall-cleanup.ps1");
        if (File.Exists(cleanupScript))
        {
            Directory.CreateDirectory(Path.Combine(installDir, "scripts"));
            File.Copy(cleanupScript, Path.Combine(installDir, "scripts", "uninstall-cleanup.ps1"), overwrite: true);
        }
        using var installKey = Registry.CurrentUser.CreateSubKey(InstallRegistryKey);
        installKey?.SetValue("InstallLocation", installDir);
        installKey?.SetValue("KeepShortcuts", "true");
        installKey?.SetValue("ShortcutName", DisplayName);

        using var uninstallKey = Registry.CurrentUser.CreateSubKey(UninstallRegistryKey);
        if (uninstallKey is null) throw new EngineException("无法写入卸载注册表项");
        uninstallKey.SetValue("DisplayName", DisplayName);
        uninstallKey.SetValue("DisplayVersion", ReadPayloadVersion());
        uninstallKey.SetValue("DisplayIcon", LaunchPath + ",0");
        uninstallKey.SetValue("InstallLocation", installDir);
        uninstallKey.SetValue("UninstallString", $"\"{uninstallExe}\"");
        uninstallKey.SetValue("QuietUninstallString", $"\"{uninstallExe}\" /S");
        uninstallKey.SetValue("Publisher", Publisher);
        uninstallKey.SetValue("NoModify", 1, RegistryValueKind.DWord);
        uninstallKey.SetValue("NoRepair", 1, RegistryValueKind.DWord);
        uninstallKey.SetValue("EstimatedSize", (int)Math.Min(EstimateInstallSize() / 1024, int.MaxValue), RegistryValueKind.DWord);
    }

    private string ReadPayloadVersion()
    {
        var versionPath = Path.Combine(payloadDir!, "version.txt");
        return File.Exists(versionPath) ? File.ReadAllText(versionPath).Trim() : "0.0.0";
    }

    private long EstimateInstallSize()
    {
        try
        {
            return EstimateDirectorySize(installDir);
        }
        catch { return 0; }
    }

    /// <summary>Recursive size walk that never follows junctions/symlinks: by
    /// step 9 &lt;install&gt;\resources holds junctions into the shared runtime
    /// cache, and walking them would both stall the install tail and inflate
    /// EstimatedSize by the whole cache.</summary>
    private static long EstimateDirectorySize(string root)
    {
        long total = 0;
        foreach (var file in Directory.EnumerateFiles(root))
        {
            try { total += new FileInfo(file).Length; } catch { /* a locked file must not fail the estimate */ }
        }
        foreach (var dir in Directory.EnumerateDirectories(root))
        {
            if ((File.GetAttributes(dir) & FileAttributes.ReparsePoint) != 0) continue;
            try { total += EstimateDirectorySize(dir); } catch { /* best-effort estimate */ }
        }
        return total;
    }

    private void CreateShortcut(string folder)
    {
        var linkPath = Path.Combine(folder, DisplayName + ".lnk");
        var shellType = Type.GetTypeFromProgID("WScript.Shell")
            ?? throw new EngineException("无法创建快捷方式");
        dynamic shell = Activator.CreateInstance(shellType)!;
        try
        {
            dynamic shortcut = shell.CreateShortcut(linkPath);
            shortcut.TargetPath = LaunchPath;
            shortcut.WorkingDirectory = installDir;
            shortcut.IconLocation = LaunchPath + ",0";
            shortcut.Save();
        }
        finally
        {
            try { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); } catch { }
        }
    }

    // ------------------------------------------------------------- rollback

    /// <summary>Cancel/failure rollback, aligned with the NSIS Abort semantics:
    /// component pointers restore from the state file (shared recover script),
    /// a detached previous version moves back, and a fresh incomplete install
    /// directory is removed outright.</summary>
    private async Task RollbackAsync(string reason)
    {
        if (installCommitted || !transactionOwned) return;
        var failures = new List<string>();
        try
        {
            await RunPowerShellAsync(
                Path.Combine(ScriptsDir, "recover-component-switch.ps1"),
                $"-RuntimeRoot \"{runtimeRoot}\"", CancellationToken.None,
                failureMessage: "组件状态恢复失败");
        }
        catch (Exception ex) { failures.Add(ex.Message); }
        try
        {
            transaction.Rollback(preserveJournal: failures.Count > 0);
            File.Delete(Path.Combine(appDataRoot, "old-install-path.txt"));
        }
        catch (Exception ex) { failures.Add(ex.Message); }
        try
        {
            if (inferenceMarkerTouched)
            {
                var marker = Path.Combine(appDataRoot, "pending-local-inference-install");
                if (previousInferenceMarker is null) File.Delete(marker);
                else File.WriteAllBytes(marker, previousInferenceMarker);
            }
        }
        catch (Exception ex) { failures.Add(ex.Message); }
        try { registrationSnapshot?.Restore(); }
        catch (Exception ex) { failures.Add(ex.Message); }
        if (failures.Count > 0)
            progress.Report(new EngineEvent(Type: "phase", Label: "安装恢复未完成，请保留安装目录并重试", Detail: string.Join("; ", failures)));
        try
        {
            if (Directory.Exists(workDir)) Directory.Delete(workDir, recursive: true);
        }
        catch { }
    }

    // -------------------------------------------------------------- helpers

    private void ReportPhase(string label) => progress.Report(new EngineEvent(Type: "phase", Label: label));

    private Task RunPowerShellAsync(string script, string arguments, CancellationToken ct, string? failureMessage)
    {
        var quoted = $"\"{script}\" {arguments}";
        return ShellProcessRunner.RunAsync("powershell.exe",
            $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -File {quoted}", ct,
            failureMessage: failureMessage);
    }
    internal static void CopyDirectory(string source, string destination)
    {
        // A prior interrupted copy may have created only part of the target.
        // Complete missing files without replacing the user's newer versions.
        if ((File.GetAttributes(source) & FileAttributes.ReparsePoint) != 0)
            throw new EngineException("用户 Skills 包含目录链接，请先备份后重试安装。");
        for (var parent = new DirectoryInfo(destination); parent is not null; parent = parent.Parent)
            if (parent.Exists && (parent.Attributes & FileAttributes.ReparsePoint) != 0)
                throw new EngineException("用户 Skills 目标不能是目录链接。");
        Directory.CreateDirectory(destination);
        foreach (var dir in Directory.EnumerateDirectories(source))
            CopyDirectory(dir, Path.Combine(destination, Path.GetFileName(dir)));
        foreach (var file in Directory.EnumerateFiles(source))
        {
            var target = Path.Combine(destination, Path.GetFileName(file));
            if ((File.GetAttributes(file) & FileAttributes.ReparsePoint) != 0)
                throw new EngineException("用户 Skills 包含文件链接，请先备份后重试安装。");
            if (File.Exists(target)) continue;
            // A failed copy must not leave a truncated final filename that a
            // retry would mistake for an existing user file.
            var temporary = target + ".migration." + Guid.NewGuid().ToString("n");
            try
            {
                File.Copy(file, temporary, overwrite: false);
                File.Move(temporary, target);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
    }
}
