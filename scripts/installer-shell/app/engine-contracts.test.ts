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
  expect(installer).toContain('"mingit", "cmd", "git.exe"');
  for (const sentinel of [
    'git.exe',
    'libiconv-2.dll',
    'libintl-8.dll',
    'libpcre2-8-0.dll',
    'libwinpthread-1.dll',
    'zlib1.dll',
  ]) {
    expect(installer).toContain(`"mingit", "mingw64", "bin", "${sentinel}"`);
  }
  expect(installer).toContain('"resources", "app.asar"');
  expect(installer).toContain('StepWritePendingInferenceMarker(localInference)');
  expect(installer).toContain('StepMigrateUserSkills(cancellationToken)');
  expect(form).toContain('public void StartInstall(string installPath, bool localInference)');
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

test('install and uninstall reject foreign directories before stopping any process', () => {
  expect(installer.indexOf('transaction.ValidateOwnership();')).toBeLessThan(
    installer.indexOf('await StepStopAppProcesses('),
  );
  expect(uninstaller.indexOf('ValidateInstallOwnership();')).toBeLessThan(
    uninstaller.indexOf('await StepStopAppProcesses('),
  );
  const ownership = transaction.slice(
    transaction.indexOf('public void ValidateOwnership()'),
    transaction.indexOf('public void Begin()'),
  );
  expect(ownership).toContain('ReadState()');
  expect(ownership).not.toMatch(/Directory\.(Move|Delete)|File\.(Write|Delete)/);
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
  expect(installer).toContain('File.Copy(uninstallerHost, uninstallExe, overwrite: true)');
  expect(installer).not.toContain('CopyUninstallerHost');
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
  expect(form.match(/installCts = new CancellationTokenSource\(\);/g)).toHaveLength(2);
  expect(form).toContain('if (!operationActive) return;');
  expect(form).toContain('e.Cancel = true;');
  expect(form).toContain('closeRequested = true;');
  expect(form).toContain('finally { BeginInvoke(FinishOperation); }');
  expect(form).not.toContain(
    'Directory.EnumerateDirectories(Path.GetTempPath(), "zhiyuan-setup-*")',
  );
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
        'UninstallerEngine.cs',
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

    var skills = Path.Combine(root, "skills-source");
    var migrated = Path.Combine(root, "skills-target");
    Directory.CreateDirectory(skills); Directory.CreateDirectory(migrated);
    File.WriteAllText(Path.Combine(skills, "a"), "old"); File.WriteAllText(Path.Combine(skills, "b"), "missing");
    File.WriteAllText(Path.Combine(migrated, "a"), "user-newer");
    InstallerEngine.CopyDirectory(skills, migrated);
    Check(File.ReadAllText(Path.Combine(migrated, "a")) == "user-newer", "migration overwrote user changes");
    Check(File.ReadAllText(Path.Combine(migrated, "b")) == "missing", "migration retry skipped missing file");

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
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  120_000,
);
