import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test, expect } from 'vitest';

const sourceRoot = __dirname;
const read = (name: string) => fs.readFileSync(path.join(sourceRoot, name), 'utf8');
const installer = read('InstallerEngine.cs');
const uninstaller = read('UninstallerEngine.cs');
const form = read('SetupForm.cs');
const transaction = read('InstallDirectoryTransaction.cs');
const argumentsSource = read('SetupArguments.cs');

test('engine checks extraction and retains all main repository runtime features', () => {
  expect(installer).toContain('failureMessage: "应用程序解包失败"');
  expect(installer).toContain('File.ReadAllText(TargetsPath)');
  expect(installer).toContain('targets.RootElement.GetArrayLength() != 7');
  expect(installer).toContain('target.GetProperty("sentinel")');
  expect(installer).toContain('"resources", "app.asar"');
  expect(installer).toContain('StepWritePendingInferenceMarker(localInference)');
  expect(installer).toContain('StepMigrateUserSkills(cancellationToken)');
  expect(form).toContain('public void StartInstall(string installPath, bool localInference)');
});

test('payload progress is bounded at its source and UI delivery has only one marshal', () => {
  expect(installer).toContain('if (percent <= lastReportedPercent) return;');
  expect(installer).toContain(
    'ReportPayloadProgress(progress, doneBytes, totalBytes, ref lastReportedPercent);',
  );
  expect(installer).toContain(
    'ReportPayloadProgress(progress, totalBytes, totalBytes, ref lastReportedPercent);',
  );
  const onEvent = form.slice(
    form.indexOf('private void OnEngineEvent('),
    form.indexOf('private void OnWebViewReady('),
  );
  expect(onEvent.match(/BeginInvoke\(/g)).toHaveLength(1);
  expect(onEvent).toContain(
    'if (InvokeRequired) { BeginInvoke(() => OnEngineEvent(evt)); return; }',
  );
  expect(onEvent).toContain('core.PostWebMessageAsJson(json);');
  expect(form.match(/BeginInvoke\(\(\) => OnEngineEvent\(evt\)\)/g)).toHaveLength(1);
});

test('mandatory registration finishes before commit and destructive cleanup', () => {
  const run = installer.slice(
    installer.indexOf('public async Task RunAsync'),
    installer.indexOf('private async Task ResolvePayloadDirAsync'),
  );
  const register = run.indexOf('StepRegisterUninstall();');
  const commit = run.indexOf('transaction.MarkCommitted();');
  const cleanup = run.indexOf('await StepCleanup(', commit);
  expect(register).toBeGreaterThan(0);
  expect(commit).toBeGreaterThan(register);
  expect(cleanup).toBeGreaterThan(commit);
  expect(run).toContain('File.Delete(Path.Combine(runtimeRoot, "component-switch-state.txt"))');
  expect(installer).toContain('registrationSnapshot?.Restore()');
  expect(installer).toContain('"-UseExactOldInstallPath " + previousInstallArgument');
  expect(installer).toContain('transaction.BackupDir is { } backup');
  const committedRecovery = run.slice(
    run.indexOf('if (transaction.HasPendingState && transaction.IsCommitted)'),
    run.indexOf('await StepRecoverComponentSwitch'),
  );
  expect(committedRecovery.indexOf('await StepCleanup(')).toBeGreaterThan(0);
  expect(committedRecovery.indexOf('transaction.Finish()')).toBeGreaterThan(
    committedRecovery.indexOf('await StepCleanup('),
  );
});

test('shortcuts use explicit Unicode COM with bounded native failure diagnostics', () => {
  for (const operation of [
    'IShellLinkW.Activate',
    'IShellLinkW.SetPath',
    'IShellLinkW.SetWorkingDirectory',
    'IShellLinkW.SetIconLocation',
    'IPersistFile.Save',
  ]) {
    expect(installer).toContain(`operation = "${operation}"`);
  }
  expect(installer).not.toContain('WScript.Shell');
  expect(installer).toContain('exception.HResult:X8');
  expect(installer).toContain('new StackTrace(exception, fNeedFileInfo: false)');
  expect(installer).toContain('Marshal.FinalReleaseComObject(shortcut)');
  expect(read('WindowsShellLink.cs')).toContain('000214F9-0000-0000-C000-000000000046');
  expect(read('WindowsShellLink.cs')).toContain('UnmanagedType.LPWStr');
});

test('install and uninstall reject foreign directories before stopping any process', () => {
  expect(installer.indexOf('transaction.ValidateOwnership();')).toBeLessThan(
    installer.indexOf('await StepStopAppProcesses('),
  );
  expect(uninstaller.indexOf('ValidateInstallOwnership();')).toBeLessThan(
    uninstaller.indexOf('await StepStopAppProcesses('),
  );
  const ownership = transaction.slice(
    transaction.indexOf('public void ValidateOwnership('),
    transaction.indexOf('public void Begin()'),
  );
  expect(ownership).toContain('ReadState()');
  expect(ownership).not.toMatch(/Directory\.(Move|Delete)|File\.(Write|Delete)/);
});

test('process shutdown waits for the exact matched handles within a cancellable total budget', () => {
  for (const engine of [installer, uninstaller]) {
    const stop = engine.slice(
      engine.indexOf('private async Task StepStopAppProcesses('),
      engine.indexOf('private IEnumerable<Process> FindInstallRootProcesses()'),
    );
    expect(stop).toContain('CancellationTokenSource.CreateLinkedTokenSource(ct)');
    expect(stop).toContain('deadline.CancelAfter(TimeSpan.FromSeconds(10))');
    expect(stop).toContain('proc.WaitForExitAsync(deadline.Token)');
    expect(stop).toContain('finally { foreach (var proc in targets) proc.Dispose(); }');
    expect(stop).toContain('when (!ct.IsCancellationRequested)');
    expect(engine).toContain('try { _ = proc.Handle; path = proc.MainModule?.FileName; }');
    expect(stop.indexOf('proc.WaitForExitAsync')).toBeGreaterThan(stop.indexOf('proc.Kill()'));
    expect(stop).not.toContain('entireProcessTree');
  }
  expect(installer).toContain(
    'throw new EngineException(message, $"running={running}\\n{DescribeFailure(ex)}")',
  );
});

test('upgrade rollback removes partial new files before restoring the previous application', () => {
  const partialRemoval = transaction.indexOf(
    'DeleteTreeWithoutFollowingLinks(installDir);',
    transaction.indexOf('else if (Directory.Exists(pending.BackupDir))'),
  );
  const restore = transaction.indexOf('Directory.Move(pending.BackupDir, installDir);');
  expect(partialRemoval).toBeGreaterThan(0);
  expect(restore).toBeGreaterThan(partialRemoval);
  expect(transaction).toContain('Guid.TryParseExact');
  expect(transaction).toContain('FileAttributes.ReparsePoint');
  expect(transaction).toContain('File.Move(temporary, journalPath, overwrite: true)');
  expect(installer).toContain('preserveJournal: failures.Count > 0');
});

test('uninstall preserves personal data and frees the old path before updater cleanup', () => {
  expect(uninstaller).not.toMatch(
    /StepRemoveAppData|Directory\.Delete\(appDataRoot|正在删除个人数据/,
  );
  const detach = uninstaller.indexOf('StepDetachInstallDirectory();');
  const runtimeCleanup = uninstaller.indexOf('await StepCleanupRuntimeCaches(');
  expect(detach).toBeGreaterThan(0);
  expect(runtimeCleanup).toBeGreaterThan(detach);
  expect(uninstaller).toContain('installDir + ".uninstall." + Guid.NewGuid().ToString("n")');
  expect(uninstaller).toContain('startInfo.Environment["ZY_UNINSTALL_TREE"] = detachedInstallDir');
  expect(uninstaller).not.toContain('rd /s /q');
});

test('uninstaller preserves the separately signed host bytes', () => {
  expect(installer).toContain('Path.Combine(payloadDir!, "uninstall.exe")');
  expect(installer).toContain('Path.Combine(installDir, "Uninstall " + DisplayName + ".exe")');
  expect(installer).toContain('File.Copy(uninstallerHost, uninstallExe, overwrite: true)');
  expect(installer).not.toContain('CopyUninstallerHost');
  expect(installer).toContain('QuietUninstallString');
  expect(installer).toContain('\\\"{uninstallExe}\\\" /S');
  expect(installer).toContain('Path.Combine(installDir, "resources", "vc_redist.x64.exe")');
});

test('silent NSIS uninstall arguments work without a WebView2 or automatic launch', () => {
  expect(argumentsSource).toContain('value.Equals("/S", StringComparison.OrdinalIgnoreCase)');
  expect(argumentsSource).toContain('value.StartsWith("_?=", StringComparison.Ordinal)');
  expect(form).toContain('if (SetupArguments.IsSilent(args))');
  const silent = form.slice(
    form.indexOf('public static int RunSilentInstall'),
    form.indexOf('internal static string? ValueAfter'),
  );
  expect(silent).toContain('engine.RunAsync(false, CancellationToken.None)');
  expect(silent).not.toMatch(/LaunchApp|Process\.Start/);
});

test('launch failure remains recoverable and successful launch has an explicit result', () => {
  const launch = form.slice(
    form.indexOf('internal bool LaunchApp()'),
    form.indexOf('internal string GetLicenseText()'),
  );
  expect(launch).toContain('Type: "launch-error"');
  expect(launch).toContain('Type: "launched"');
  expect(launch).toContain('return false;');
  expect(launch).not.toContain('Close()');
  expect(launch).toContain('if (launchStarted) return true;');
  expect(launch).toContain('Arguments = completedUpgrade ? "--updated" : string.Empty');
  expect(installer).toContain('isUpgrade = File.Exists(LaunchPath)');
});

test('retry gets a fresh cancellation token and closing waits for the engine to stop', () => {
  expect(form).toContain('private readonly SetupOperation operation = new();');
  expect(form).toContain('private bool operationActive => operation.IsActive;');
  expect(form.match(/var cancellationToken = operation.Begin\(\);/g)).toHaveLength(2);
  expect(form).toContain('await runEngine.RunAsync(localInference, cancellationToken);');
  expect(form).toContain('await uninstaller.UninstallAsync(cancellationToken);');
  expect(form).toContain('operation.Complete();');
  expect(form).not.toContain('installCts');
  expect(form).toContain('if (!operationActive) return;');
  expect(form).toContain('e.Cancel = true;');
  expect(form).toContain('closeRequested = true;');
  expect(form).toContain('finally { BeginInvoke(FinishOperation); }');
  expect(form).not.toContain(
    'Directory.EnumerateDirectories(Path.GetTempPath(), "zhiyuan-setup-*")',
  );
});

test('start acknowledges UI admission before cancel and never waits for an engine or browser callback', () => {
  const startInstall = form.slice(
    form.indexOf('internal void StartInstall('),
    form.indexOf('private void FinishOperation()'),
  );
  const startUninstall = form.slice(
    form.indexOf('internal void StartUninstall()'),
    form.indexOf('internal bool LaunchApp()'),
  );
  expect(startInstall).toContain(
    'Invoke(new Action(() => StartInstall(engineInstallDir, localInference)))',
  );
  expect(startUninstall).toContain('Invoke(new Action(StartUninstall))');
  expect(startInstall).toContain('if (uninstallMode || installState == "done") return;');
  expect(startUninstall).toContain('if (!uninstallMode || installState == "done") return;');
  for (const start of [startInstall, startUninstall]) {
    expect(start).not.toContain('if (operationActive');
    expect(start.indexOf('var cancellationToken = operation.Begin();')).toBeLessThan(
      start.indexOf('_ = Task.Run('),
    );
    expect(start).not.toMatch(/\.Wait\(|\.Result|GetAwaiter|ExecuteScriptAsync/);
  }
  const cancel = form.slice(
    form.indexOf('internal void CancelInstall()'),
    form.indexOf('internal string? BrowseInstallDir('),
  );
  expect(cancel).toContain('Invoke(new Action(CancelInstall))');
  expect(cancel).toContain('if (!operationActive || installState == "done") return;');
  expect(cancel).toContain('operation.Cancel();');
  expect(form).toContain('RecordLifecycle("operation-admitted")');
  expect(form).toContain('RecordLifecycle("cancel-received")');
});

test('host close queues the normal rollback lifecycle and keeps diagnostic output bounded', () => {
  expect(form).toContain('public void RequestClose() => form.RequestClose();');
  const close = form.slice(
    form.indexOf('internal void RequestClose()'),
    form.indexOf('private void RecordLifecycle('),
  );
  expect(close).toContain('BeginInvoke(() =>');
  expect(close).toContain('RecordLifecycle("bridge-close-dispatched")');
  expect(close).toContain('Close();');
  expect(close).not.toMatch(/Environment\.Exit|Application\.Exit|Dispose\(|operationActive\s*=/);
  const formClosing = form.slice(form.indexOf('FormClosing +='), form.indexOf('FormClosed +='));
  for (const marker of [
    'if (!operationActive) return;',
    'e.Cancel = true;',
    'closeRequested = true;',
    'operation.Cancel();',
  ])
    expect(formClosing).toContain(marker);
  expect(form).toContain('if (closeRequested) Close();');
  expect(form).toContain('if (lifecycleEvents++ >= 64) return;');
  for (const stage of [
    'form-closing',
    'form-close-deferred',
    'form-closed',
    'form-cleanup-finished',
    'operation-finished',
  ])
    expect(form).toContain(`RecordLifecycle("${stage}")`);
  // This fix uses the working host-object transport, not a second subscription.
  expect(form).toContain('webView.WebMessageReceived += OnWebMessage;');
  expect(form).not.toContain('webView.CoreWebView2.WebMessageReceived += OnWebMessage;');
});

test('license is embedded and acceptance debugging is opt-in, loopback-only and isolated', () => {
  expect(read('ZhiYuan.Setup.Shell.csproj')).toContain('LogicalName="ui.license"');
  expect(form).toContain('GetManifestResourceStream("ui.license")');
  expect(form).toContain('if (port is not null)');
  expect(form).toContain('--remote-debugging-address=127.0.0.1 --remote-debugging-port=');
  expect(form).toContain(
    'CoreWebView2Environment.CreateAsync(browserExecutableFolder, webViewDataDir, browserOptions)',
  );
  expect(form).toContain('Type: "webview2-error"');
  expect(argumentsSource).toContain('"--events-log"');
  expect(form).not.toMatch(/DownloadFile|DownloadString/);
  expect(form).toContain('https://developer.microsoft.com/microsoft-edge/webview2/');
});

const dotnet = process.env.ZHIYUAN_DOTNET || 'dotnet';
const dotnetAvailable = spawnSync(dotnet, ['--version'], { encoding: 'utf8' }).status === 0;

test.skipIf(!dotnetAvailable)(
  'actual C# transaction recovery preserve old files and bound deletion',
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zy-engine-contracts-'));
    const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    try {
      const sources = [
        'InstallerEngine.cs',
        'SfxPayload.cs',
        'InstallDirectoryTransaction.cs',
        'InstallRegistrationSnapshot.cs',
        'ShellProcessRunner.cs',
        'WindowsShellLink.cs',
        'UninstallerEngine.cs',
        'SetupOperation.cs',
      ];
      fs.writeFileSync(
        path.join(root, 'Contracts.csproj'),
        `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings></PropertyGroup><ItemGroup>${sources.map(file => `<Compile Include="${xml(path.join(sourceRoot, file))}" />`).join('')}</ItemGroup></Project>`,
      );
      fs.writeFileSync(
        path.join(root, 'Program.cs'),
        `
using System.Text.Json;
using ZhiYuan.Setup.Shell;
static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
var root = Path.Combine(Path.GetTempPath(), "zy-engine-behavior-" + Guid.NewGuid().ToString("n"));
Directory.CreateDirectory(root);
try {
    using (var operation = new SetupOperation()) {
        operation.Cancel();
        var admittedToken = operation.Begin();
        Check(operation.IsActive && !admittedToken.IsCancellationRequested, "idle cancel poisoned admission");
        var originalCulture = System.Globalization.CultureInfo.CurrentUICulture;
        try {
            foreach (var culture in new[] { "zh-CN", "en-US" }) {
                System.Globalization.CultureInfo.CurrentUICulture = System.Globalization.CultureInfo.GetCultureInfo(culture);
                var busyRejected = false;
                try { operation.Begin(); } catch (InvalidOperationException ex) {
                    busyRejected = true;
                    Check(ex.Message.Contains(culture == "zh-CN" ? "请稍候重试" : "Please try again shortly"), "busy admission message did not follow the UI culture");
                }
                Check(busyRejected && operation.IsActive, "busy admission silently succeeded or ended the original operation");
            }
        } finally { System.Globalization.CultureInfo.CurrentUICulture = originalCulture; }
        using var startWorker = new ManualResetEventSlim();
        var queuedWorker = Task.Run(() => {
            startWorker.Wait();
            return admittedToken.IsCancellationRequested;
        });
        operation.Cancel();
        startWorker.Set();
        Check(queuedWorker.GetAwaiter().GetResult(), "cancel between admission and worker start was lost");
        Check(operation.IsActive, "cancel incorrectly completed the operation before rollback");
        operation.Complete();
        Check(!operation.IsActive, "worker completion did not release operation");
        operation.Cancel();
        var retryToken = operation.Begin();
        Check(!retryToken.IsCancellationRequested && retryToken != admittedToken, "retry reused a cancelled token");
        Check(admittedToken.IsCancellationRequested, "retry changed the previous worker token");
        operation.Cancel();
        Check(retryToken.IsCancellationRequested, "active retry cancellation was lost");
        operation.Complete();
        var successToken = operation.Begin();
        operation.Complete();
        operation.Cancel();
        Check(!successToken.IsCancellationRequested, "late cancellation changed a completed operation");
        var nextToken = operation.Begin();
        Check(!nextToken.IsCancellationRequested, "late cancellation poisoned the next operation");
        operation.Complete();
    }
    Console.WriteLine("PASS: admission cancellation reaches the queued worker; rollback stays active; retries and completed operations are isolated");

    var payloadEvents = new List<EngineEvent>();
    var payloadProgress = new ContractProgress(payloadEvents.Add);
    var lastPercent = -1;
    const int reads = 100_000;
    for (var bytes = 0; bytes <= reads; bytes++)
        InstallerEngine.ReportPayloadProgress(payloadProgress, bytes, reads, ref lastPercent);
    InstallerEngine.ReportPayloadProgress(payloadProgress, reads, reads, ref lastPercent);
    Check(payloadEvents.Count == 101, "payload queued more than one event per visible percentage");
    Check(payloadEvents.Select(evt => evt.Percent).SequenceEqual(Enumerable.Range(0, 101).Select(value => (int?)value)), "payload percentages were not monotonic and complete");
    Check(payloadEvents[^1].BytesDone == reads && payloadEvents[^1].BytesTotal == reads, "payload final byte count was lost");
    foreach (var terminal in new[] { "done", "error" }) {
        payloadProgress.Report(new EngineEvent(Type: "phase", Label: "ready"));
        payloadProgress.Report(new EngineEvent(Type: terminal));
        InstallerEngine.ReportPayloadProgress(payloadProgress, reads / 2, reads, ref lastPercent);
        Check(payloadEvents[^2].Type == "phase" && payloadEvents[^1].Type == terminal, "stale progress overtook a phase or terminal event");
    }
    var emptyEvents = new List<EngineEvent>();
    var emptyProgress = new ContractProgress(emptyEvents.Add);
    lastPercent = -1;
    InstallerEngine.ReportPayloadProgress(emptyProgress, 0, 0, ref lastPercent);
    Check(emptyEvents.Count == 1 && emptyEvents[0].Percent == 100, "empty payload did not report completion");
    Console.WriteLine("PASS: 100000 payload reads produce 101 ordered updates and no stale progress after completion");

    var install = Path.Combine(root, "app");
    var data = Path.Combine(root, "user-data");
    Directory.CreateDirectory(data);
    File.WriteAllText(Path.Combine(data, "sessions.sqlite"), "personal");
    Directory.CreateDirectory(Path.Combine(install, "resources"));
    File.WriteAllText(Path.Combine(install, "resources", "app.asar"), "old-asar");
    File.WriteAllText(Path.Combine(install, InstallerEngine.AppExeName), "old");
    var first = new InstallDirectoryTransaction(install);
    first.Begin();
    Directory.CreateDirectory(install);
    File.WriteAllText(Path.Combine(install, InstallerEngine.AppExeName), "partial-new");
    File.WriteAllText(Path.Combine(install, "partial.txt"), "partial");
    new InstallDirectoryTransaction(install).Rollback();
    Check(File.ReadAllText(Path.Combine(install, InstallerEngine.AppExeName)) == "old", "interrupted upgrade lost old app");
    Check(!File.Exists(Path.Combine(install, "partial.txt")), "partial upgrade survived rollback");
    Check(File.ReadAllText(Path.Combine(data, "sessions.sqlite")) == "personal", "personal data changed");

    var emptyInstall = Path.Combine(root, "empty-install");
    Directory.CreateDirectory(emptyInstall);
    new InstallDirectoryTransaction(emptyInstall).Begin();
    Directory.CreateDirectory(emptyInstall);
    File.WriteAllText(Path.Combine(emptyInstall, "partial"), "new");
    new InstallDirectoryTransaction(emptyInstall).Rollback();
    Check(Directory.Exists(emptyInstall) && !Directory.EnumerateFileSystemEntries(emptyInstall).Any(), "empty original directory was not restored");

    var fresh = Path.Combine(root, "fresh");
    var freshTransaction = new InstallDirectoryTransaction(fresh);
    freshTransaction.Begin();
    Directory.CreateDirectory(fresh);
    File.WriteAllText(Path.Combine(fresh, "partial"), "new");
    new InstallDirectoryTransaction(fresh).Rollback();
    Check(!Directory.Exists(fresh), "fresh failed installation was not removed");

    var committed = new InstallDirectoryTransaction(install);
    committed.Begin();
    Directory.CreateDirectory(install);
    File.WriteAllText(Path.Combine(install, InstallerEngine.AppExeName), "committed-new");
    committed.MarkCommitted();
    var recovery = new InstallDirectoryTransaction(install);
    Check(recovery.IsCommitted, "commit marker was not durable");
    recovery.Rollback();
    Check(File.ReadAllText(Path.Combine(install, InstallerEngine.AppExeName)) == "committed-new", "committed app rolled back");
    recovery.Finish();

    File.WriteAllText(install + ".setup-state.json", JsonSerializer.Serialize(new { InstallDir=install, BackupDir=data, Committed=false }));
    var refused = false;
    try { new InstallDirectoryTransaction(install).Rollback(); } catch (EngineException) { refused = true; }
    Check(refused && Directory.Exists(data), "foreign recovery path was accepted");
    File.Delete(install + ".setup-state.json");
    refused = false;
    try { InstallDirectoryTransaction.ValidateRoots(data, Path.Combine(root, "runtime"), data); } catch (EngineException) { refused = true; }
    Check(refused, "installation accepted the data root");

    refused = false;
    try { new InstallDirectoryTransaction(data).ValidateOwnership(); } catch (EngineException) { refused = true; }
    Check(refused && File.ReadAllText(Path.Combine(data, "sessions.sqlite")) == "personal", "foreign directory was not rejected without mutation");

    refused = false;
    try { new InstallDirectoryTransaction(Path.Combine(root, "missing-app")).ValidateOwnership(requireInstalled: true); } catch (EngineException) { refused = true; }
    Check(refused, "uninstall accepted a missing owned installation");
    var linkedInstall = Path.Combine(root, "linked-app");
    Directory.CreateDirectory(linkedInstall);
    File.WriteAllText(Path.Combine(linkedInstall, InstallerEngine.AppExeName), "app");
    var linkedResources = Path.Combine(linkedInstall, "resources");
    if (OperatingSystem.IsWindows()) {
        var linkStart = new System.Diagnostics.ProcessStartInfo("cmd.exe") { UseShellExecute = false, CreateNoWindow = true };
        foreach (var argument in new[] { "/d", "/c", "mklink", "/J", linkedResources, data }) linkStart.ArgumentList.Add(argument);
        using var linkProcess = System.Diagnostics.Process.Start(linkStart)!;
        linkProcess.WaitForExit();
        Check(linkProcess.ExitCode == 0, "could not create junction fixture");
    } else Directory.CreateSymbolicLink(linkedResources, data);
    File.WriteAllText(Path.Combine(data, "app.asar"), "foreign");
    refused = false;
    try { new InstallDirectoryTransaction(linkedInstall).ValidateOwnership(requireInstalled: true); } catch (EngineException) { refused = true; }
    Check(refused, "uninstall accepted linked resources");
    Directory.Delete(linkedResources);

    var skills = Path.Combine(root, "skills-source");
    var migrated = Path.Combine(root, "skills-target");
    Directory.CreateDirectory(skills); Directory.CreateDirectory(migrated);
    File.WriteAllText(Path.Combine(skills, "a"), "old"); File.WriteAllText(Path.Combine(skills, "b"), "missing");
    File.WriteAllText(Path.Combine(migrated, "a"), "user-newer");
    InstallerEngine.CopyDirectory(skills, migrated);
    Check(File.ReadAllText(Path.Combine(migrated, "a")) == "user-newer", "migration overwrote user changes");
    Check(File.ReadAllText(Path.Combine(migrated, "b")) == "missing", "migration retry skipped missing file");

    if (OperatingSystem.IsWindows()) {
        // Use only the runner's own Windows binary, copied into isolated roots.
        // Loopback ping remains alive until the real production stop method
        // terminates it; a sibling-root instance must not be touched.
        var systemPing = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "PING.EXE");
        var outsideRoot = Path.Combine(root, "outside-process");
        Directory.CreateDirectory(outsideRoot);
        var outsideExe = Path.Combine(outsideRoot, "ping.exe");
        File.Copy(systemPing, outsideExe);
        System.Diagnostics.Process StartPing(string executable) => System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo {
            FileName = executable, Arguments = "-t 127.0.0.1", WorkingDirectory = root,
            UseShellExecute = false, CreateNoWindow = true,
        }) ?? throw new Exception("Could not start the Windows process fixture");
        void StopFixture(System.Diagnostics.Process process) {
            if (process.HasExited) return;
            process.Kill();
            Check(process.WaitForExit(10000), "Process fixture cleanup timed out");
        }
        using var outsideProcess = StartPing(outsideExe);
        try {
            Check(!outsideProcess.WaitForExit(100), "External fixture exited before the test");
            foreach (var uninstall in new[] { false, true }) {
                var stopRoot = Path.Combine(root, uninstall ? "停止 卸载" : "停止 安装");
                Directory.CreateDirectory(Path.Combine(stopRoot, "resources"));
                File.WriteAllText(Path.Combine(stopRoot, "resources", "app.asar"), "process-fixture-asar");
                var targetExe = Path.Combine(stopRoot, InstallerEngine.AppExeName);
                File.Copy(systemPing, targetExe);
                using var targetProcess = StartPing(targetExe);
                try {
                    Check(!targetProcess.WaitForExit(100), "Owned fixture exited before the test");
                    object stopEngine = uninstall
                        ? new UninstallerEngine(stopRoot, Path.Combine(root, "runtime"), data, null, new ContractProgress(_ => {}))
                        : new InstallerEngine(null, stopRoot, Path.Combine(root, "runtime"), data, false, new ContractProgress(_ => {}));
                    var stopMethod = stopEngine.GetType().GetMethod("StepStopAppProcesses", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)
                        ?? throw new Exception("Production process-stop method is missing");
                    using var cancelledStop = new CancellationTokenSource();
                    cancelledStop.Cancel();
                    var stopCancelled = false;
                    try { ((Task)stopMethod.Invoke(stopEngine, new object[] { cancelledStop.Token })!).GetAwaiter().GetResult(); }
                    catch (OperationCanceledException) { stopCancelled = true; }
                    Check(stopCancelled && !targetProcess.HasExited, "Pre-cancelled stop killed an app or ignored cancellation");
                    ((Task)stopMethod.Invoke(stopEngine, new object[] { CancellationToken.None })!).GetAwaiter().GetResult();
                    Check(targetProcess.HasExited, "Stop returned before the matched process handle signalled exit");
                    Check(!outsideProcess.HasExited, "Stop killed a process outside its owned roots");
                    var stoppedTransaction = new InstallDirectoryTransaction(stopRoot);
                    stoppedTransaction.Begin();
                    Check(!Directory.Exists(stopRoot) && Directory.Exists(stoppedTransaction.BackupDir), "Immediate rename after stop failed");
                    stoppedTransaction.Rollback();
                    Check(File.Exists(targetExe), "Stopped installation could not be restored");
                } finally { StopFixture(targetProcess); }
            }
        } finally { StopFixture(outsideProcess); }
        Console.WriteLine("PASS: actual Windows install/uninstall stop waits for exit before rename, preserves sibling processes and honors cancellation");

        // Match SetupForm's Task.Run apartment and real Unicode install path,
        // without touching the user's registry, Desktop or Start Menu.
        var shortcutInstall = Path.Combine(root, "安装 路径");
        Directory.CreateDirectory(Path.Combine(shortcutInstall, "resources"));
        File.WriteAllText(Path.Combine(shortcutInstall, "resources", "app.asar"), "shortcut-asar");
        File.WriteAllText(Path.Combine(shortcutInstall, InstallerEngine.AppExeName), "shortcut-target");
        var shortcutEngine = new InstallerEngine(null, shortcutInstall, Path.Combine(root, "runtime"), data, false, new Progress<EngineEvent>());
        foreach (var folderName in new[] { "开始菜单", "桌面" }) {
            var shortcutFolder = Path.Combine(root, folderName);
            Directory.CreateDirectory(shortcutFolder);
            Task.Run(() => {
                Check(Thread.CurrentThread.GetApartmentState() == ApartmentState.MTA, "shortcut test must match the engine's MTA worker");
                try { shortcutEngine.CreateShortcut(shortcutFolder); }
                catch (EngineException ex) { Console.Error.WriteLine(ex.Detail); throw; }
                var linkPath = Path.Combine(shortcutFolder, InstallerEngine.DisplayName + ".lnk");
                Check(File.Exists(linkPath), "shortcut file was not saved");
                var link = (IShellLinkW)new ShellLinkComObject();
                try {
                    ((System.Runtime.InteropServices.ComTypes.IPersistFile)link).Load(linkPath, 0);
                    var target = new System.Text.StringBuilder(32768);
                    link.GetPath(target, target.Capacity, IntPtr.Zero, 4);
                    Check(target.ToString() == shortcutEngine.LaunchPath, "shortcut lost its Unicode executable path");
                    var workingDirectory = new System.Text.StringBuilder(32768);
                    link.GetWorkingDirectory(workingDirectory, workingDirectory.Capacity);
                    Check(workingDirectory.ToString() == shortcutInstall, "shortcut lost its Unicode working directory");
                    var icon = new System.Text.StringBuilder(32768);
                    link.GetIconLocation(icon, icon.Capacity, out var iconIndex);
                    Check(icon.ToString() == shortcutEngine.LaunchPath && iconIndex == 0, "shortcut lost its Unicode icon path");
                } finally {
                    System.Runtime.InteropServices.Marshal.FinalReleaseComObject(link);
                }
            }).GetAwaiter().GetResult();
        }
        Console.WriteLine("PASS: actual Unicode shortcut creation and target readback on MTA worker");
    }

    // Minimal PE32+ envelope with both unsigned and certificate-bearing forms.
    byte[] Sfx(bool signed) {
        var bytes = new byte[signed ? 576 : 560];
        using var stream = new MemoryStream(bytes);
        using var writer = new BinaryWriter(stream);
        writer.Write((ushort)0x5a4d); stream.Position=0x3c; writer.Write((uint)128);
        stream.Position=128; writer.Write((uint)0x4550); writer.Write((ushort)0x8664); writer.Write((ushort)0);
        stream.Position=148; writer.Write((ushort)240);
        stream.Position=152; writer.Write((ushort)0x20b);
        stream.Position=260; writer.Write((uint)16);
        if (signed) { stream.Position=296; writer.Write((uint)560); writer.Write((uint)16); stream.Position=560; writer.Write((uint)16); writer.Write((ushort)0x200); writer.Write((ushort)2); }
        stream.Position=512; writer.Write((uint)0x04034b50);
        stream.Position=536; writer.Write((ulong)512); writer.Write((ulong)24);
        writer.Write((uint)24); writer.Write("ZYP2"u8.ToArray());
        return bytes;
    }
    foreach (var signed in new[] { false, true }) {
        using var stream = new MemoryStream(Sfx(signed));
        Check(SfxPayload.Locate(stream) == (512L, 24L), "signed payload location failed");
    }
    var corrupt = Sfx(true); corrupt[296] = 0;
    refused = false;
    try { using var stream = new MemoryStream(corrupt); SfxPayload.Locate(stream); } catch (EngineException) { refused = true; }
    Check(refused, "corrupt certificate offset accepted");
    Console.WriteLine("PASS: transaction recovery, retention, path guards");
} finally { Directory.Delete(root, recursive: true); }
sealed class ContractProgress(Action<EngineEvent> report) : IProgress<EngineEvent> {
    public void Report(EngineEvent value) => report(value);
}
`,
      );
      const result = spawnSync(
        dotnet,
        ['run', '--project', path.join(root, 'Contracts.csproj'), '--configuration', 'Release'],
        {
          encoding: 'utf8',
          timeout: 110_000,
          env: {
            ...process.env,
            DOTNET_CLI_TELEMETRY_OPTOUT: '1',
            DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
            DOTNET_CLI_HOME: path.join(root, '.dotnet-home'),
            NUGET_PACKAGES: path.join(root, '.nuget-packages'),
          },
        },
      );
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
      expect(result.stdout).toContain('PASS: transaction recovery');
      expect(result.stdout).toContain('PASS: admission cancellation reaches the queued worker');
      expect(result.stdout).toContain('PASS: 100000 payload reads produce 101 ordered updates');
      if (process.platform === 'win32') {
        expect(result.stdout).toContain(
          'PASS: actual Windows install/uninstall stop waits for exit before rename',
        );
        expect(result.stdout).toContain(
          'PASS: actual Unicode shortcut creation and target readback on MTA worker',
        );
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  120_000,
);
