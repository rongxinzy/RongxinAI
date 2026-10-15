import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, test } from 'vitest';

const sourceRoot = path.resolve('scripts/installer-shell/app');
const scriptsRoot = path.resolve('scripts/installer');
const runner = fs.readFileSync(path.join(sourceRoot, 'ShellProcessRunner.cs'), 'utf8');
const dotnet = process.env.ZHIYUAN_DOTNET || 'dotnet';
const sha256 = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const quote = (value: string) => `"${value}"`;

test('all production shell PowerShell children use one child-only inbox environment', () => {
  expect(runner).toContain('Environment.SpecialFolder.System');
  expect(runner).toContain('FileName = PowerShellExecutablePath');
  expect(runner).toContain('startInfo.Environment["PSModulePath"] = Path.Combine(home, "Modules")');
  expect(runner).not.toContain('SetEnvironmentVariable');
  for (const file of ['InstallerEngine.cs', 'UninstallerEngine.cs']) {
    const source = fs.readFileSync(path.join(sourceRoot, file), 'utf8');
    expect(source).toContain('ShellProcessRunner.RunPowerShellAsync(');
    expect(source).not.toContain('"powershell.exe"');
  }
  expect(fs.readFileSync(path.join(sourceRoot, 'UninstallerEngine.cs'), 'utf8')).toContain(
    'ShellProcessRunner.CreatePowerShellStartInfo(',
  );
  expect(fs.readFileSync('scripts/nsis-elevated-actions.ps1', 'utf8')).toContain(
    "Import-Module -Name ([IO.Path]::Combine($PSHOME, 'Modules', 'Microsoft.PowerShell.Management', 'Microsoft.PowerShell.Management.psd1'))",
  );
});

test.skipIf(process.platform !== 'win32')(
  'real engine subprocesses expand and activate all seven components with empty or poisoned module paths',
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zy-shell-ps-environment-'));
    const originalModulePath = process.env.PSModulePath;
    const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    try {
      const project = path.join(root, 'Probe.csproj');
      fs.writeFileSync(
        project,
        `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings></PropertyGroup><ItemGroup><Compile Include="${xml(path.join(sourceRoot, 'ShellProcessRunner.cs'))}" /></ItemGroup></Project>`,
      );
      fs.writeFileSync(
        path.join(root, 'Program.cs'),
        `
using System.Text.Json;
using ZhiYuan.Setup.Shell;
var original = Environment.GetEnvironmentVariable("PSModulePath");
var probe = ShellProcessRunner.CreatePowerShellStartInfo("-NoProfile");
var home = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0");
if (probe.FileName != Path.Combine(home, "powershell.exe") ||
    probe.Environment["PSModulePath"] != Path.Combine(home, "Modules")) throw new Exception("Not bound to inbox host/modules");
using var plan = JsonDocument.Parse(File.ReadAllText(args[0]));
foreach (var step in plan.RootElement.EnumerateArray()) {
    await ShellProcessRunner.RunPowerShellAsync(step.GetProperty("script").GetString()!,
        step.GetProperty("arguments").GetString()!, CancellationToken.None, "Real production script failed");
    if (Environment.GetEnvironmentVariable("PSModulePath") != original) throw new Exception("Parent environment changed");
}
Console.WriteLine("PASS: production PowerShell child isolation and real component scripts");
namespace ZhiYuan.Setup.Shell {
    public sealed class EngineException : Exception {
        public EngineException(string message, string detail) : base(message + ": " + detail) { }
    }
}
`,
      );
      const built = spawnSync(
        dotnet,
        ['build', project, '--configuration', 'Release', '--nologo'],
        {
          encoding: 'utf8',
          timeout: 90_000,
          env: {
            ...process.env,
            DOTNET_CLI_TELEMETRY_OPTOUT: '1',
            DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
            DOTNET_CLI_HOME: path.join(root, '.dotnet-home'),
          },
        },
      );
      expect(built.status, built.stdout + built.stderr).toBe(0);
      const probeScript = path.join(root, 'probe-inbox.ps1');
      fs.writeFileSync(
        probeScript,
        `
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) { throw 'Wrong PowerShell host' }
if (-not ($env:PSModulePath.Split(';') -contains [IO.Path]::Combine($PSHOME, 'Modules'))) { throw 'Inbox modules absent' }
if ((Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.Length -ne 64) { throw 'Hash module unavailable' }
$null = Get-Item -LiteralPath $PSCommandPath
$null = Get-AuthenticodeSignature -LiteralPath ([IO.Path]::Combine($PSHOME, 'powershell.exe'))
if (-not (Get-CimInstance Win32_Process -Filter "ProcessId=$PID")) { throw 'CIM module unavailable' }
$null = @{ checked = $true } | ConvertTo-Json
`,
      );
      const poisonRoot = path.join(root, 'foreign-pwsh-modules');
      const poisonMarker = path.join(root, 'foreign-module-loaded');
      for (const name of [
        'Microsoft.PowerShell.Utility',
        'Microsoft.PowerShell.Management',
        'Microsoft.PowerShell.Security',
        'CimCmdlets',
      ]) {
        const module = path.join(poisonRoot, name);
        fs.mkdirSync(module, { recursive: true });
        fs.writeFileSync(
          path.join(module, `${name}.psd1`),
          `@{ RootModule='${name}.psm1'; ModuleVersion='99.0'; FunctionsToExport='*' }`,
        );
        fs.writeFileSync(
          path.join(module, `${name}.psm1`),
          `[IO.File]::WriteAllText('${poisonMarker.replaceAll("'", "''")}', 'wrong module'); throw 'Inherited foreign module must not load'`,
        );
      }
      const sevenZip = path.resolve('node_modules/7zip-bin/win/x64/7za.exe');
      const targetsPath = path.resolve('scripts/nsis-offline-components.json');
      const targets = JSON.parse(fs.readFileSync(targetsPath, 'utf8')) as Array<{
        key: string;
        prefix: string;
        sentinel: string;
      }>;
      expect(targets).toHaveLength(7);
      for (const [index, modulePath] of ['', poisonRoot].entries()) {
        const childEnvironment = Object.fromEntries(
          Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'psmodulepath'),
        );
        childEnvironment.PSModulePath = modulePath;
        const fixture = path.join(root, `fixture-${index}`);
        const plugin = path.join(fixture, 'plugin');
        const runtime = path.join(fixture, 'runtime');
        const resources = path.join(fixture, 'app', 'resources');
        fs.mkdirSync(plugin, { recursive: true });
        fs.mkdirSync(runtime);
        fs.mkdirSync(resources, { recursive: true });
        const components = targets.map(target => {
          const contentId = sha256(target.key);
          const staging = path.join(fixture, 'staging', target.key);
          const sentinel = path.join(staging, target.sentinel);
          const contents = `sentinel:${target.key}`;
          fs.mkdirSync(path.dirname(sentinel), { recursive: true });
          fs.writeFileSync(sentinel, contents);
          const archive = path.join(plugin, `component-${target.key}.7z`);
          const packed = spawnSync(sevenZip, ['a', '-t7z', archive, target.prefix], {
            cwd: staging,
            encoding: 'utf8',
            timeout: 10_000,
          });
          expect(packed.status, packed.stdout + packed.stderr).toBe(0);
          for (const [extension, value] of [
            ['version', contentId],
            ['sha256', sha256(fs.readFileSync(archive))],
            ['sentinel-sha256', sha256(contents)],
          ])
            fs.writeFileSync(path.join(plugin, `component-${target.key}.${extension}`), value);
          return { ...target, contentId };
        });
        const manifest = path.join(fixture, 'manifest.json');
        fs.writeFileSync(manifest, JSON.stringify({ components }));
        const step = (script: string, args: string) => ({
          script: path.join(scriptsRoot, script),
          arguments: args,
        });
        const validatorArgs = `-PluginDir ${quote(plugin)} -RuntimeRoot ${quote(runtime)} -ComponentTargetsPath ${quote(targetsPath)} -SevenZipPath ${quote(sevenZip)}`;
        const plan = [
          { script: probeScript, arguments: '' },
          step('recover-component-switch.ps1', `-RuntimeRoot ${quote(runtime)}`),
          step('validate-offline-components.ps1', `-Mode cache ${validatorArgs}`),
          step('validate-offline-components.ps1', `-Mode expand ${validatorArgs}`),
          step('validate-offline-components.ps1', `-Mode cache ${validatorArgs}`),
          step(
            'activate-components.ps1',
            `-PluginDir ${quote(plugin)} -RuntimeRoot ${quote(runtime)} -ManifestPath ${quote(manifest)} -TargetsPath ${quote(targetsPath)} -StatePath ${quote(path.join(runtime, 'component-switch-state.txt'))}`,
          ),
          step(
            'link-runtime-junctions.ps1',
            `-ResourceRoot ${quote(resources)} -RuntimeRoot ${quote(runtime)} -ManifestPath ${quote(manifest)}`,
          ),
          step(
            'cleanup-after-install.ps1',
            `-InstallDir ${quote(path.dirname(resources))} -RuntimeRoot ${quote(runtime)} -ManifestPath ${quote(manifest)} -OldInstallPathFile ${quote(path.join(fixture, 'no-old-install.txt'))} -UseExactOldInstallPath`,
          ),
        ];
        const planPath = path.join(fixture, 'plan.json');
        fs.writeFileSync(planPath, JSON.stringify(plan));
        const ran = spawnSync(dotnet, [path.join(root, 'bin/Release/net8.0/Probe.dll'), planPath], {
          encoding: 'utf8',
          timeout: 60_000,
          env: childEnvironment,
        });
        expect(ran.status, ran.stdout + ran.stderr).toBe(0);
        expect(ran.stdout).toContain('PASS: production PowerShell child isolation');
        // Exercise the elevated helper's own module import without UAC or
        // installing anything: missing input must produce its real result file.
        const vcResult = path.join(fixture, 'missing-vc-result.txt');
        const elevatedHelper = spawnSync(
          path.join(process.env.SystemRoot!, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.resolve('scripts/nsis-elevated-actions.ps1'),
            '-Action',
            'install-vc-runtime',
            '-Target',
            path.join(fixture, 'absent-vc-redist.exe'),
            '-ResultPath',
            vcResult,
          ],
          { encoding: 'utf8', timeout: 20_000, env: childEnvironment },
        );
        expect(elevatedHelper.status, elevatedHelper.stdout + elevatedHelper.stderr).toBe(1);
        expect(fs.readFileSync(vcResult, 'utf8')).toContain(
          'error|VC++ runtime installer is missing:',
        );
        expect(fs.existsSync(poisonMarker)).toBe(false);
        for (const component of components) {
          expect(fs.existsSync(path.join(plugin, `component-${component.key}.cache-valid`))).toBe(
            true,
          );
          expect(fs.readFileSync(path.join(resources, component.sentinel), 'utf8')).toBe(
            `sentinel:${component.key}`,
          );
          expect(
            fs.readFileSync(
              path.join(runtime, component.key, component.contentId, '.complete'),
              'utf8',
            ),
          ).toMatch(new RegExp(`^${component.contentId}\\|`));
        }
      }
      expect(process.env.PSModulePath).toBe(originalModulePath);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  230_000,
);
