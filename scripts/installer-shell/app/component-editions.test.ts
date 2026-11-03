import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { productSource } = require('../generate-product.cjs');
const { resolveWindowsProduct } = require('../../packaging/windows-product.cjs');
const { resolveNsisOfflineComponentTargets } =
  require('../../resolve-nsis-offline-components.cjs') as {
    resolveNsisOfflineComponentTargets: (edition: string) => { key: string; sentinel: string }[];
  };
const dotnet = process.env.ZHIYUAN_DOTNET || 'dotnet';
const dotnetAvailable = spawnSync(dotnet, ['--version']).status === 0;

test.skipIf(!dotnetAvailable)(
  'native final verification accepts every edition and rejects invalid targets',
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'zy-native-editions-'));
    const xml = (value: string) => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    try {
      fs.writeFileSync(
        path.join(root, 'InstallerProduct.g.cs'),
        productSource(resolveWindowsProduct(path.resolve(__dirname, '../../..'))),
      );
      const sources = [
        'InstallerEngine.cs',
        'SfxPayload.cs',
        'InstallDirectoryTransaction.cs',
        'InstallRegistrationSnapshot.cs',
        'ShellProcessRunner.cs',
        'WindowsShellLink.cs',
      ];
      fs.writeFileSync(
        path.join(root, 'Probe.csproj'),
        `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings></PropertyGroup><ItemGroup>${sources.map(file => `<Compile Include="${xml(path.join(__dirname, file))}" />`).join('')}</ItemGroup></Project>`,
      );
      const editions = ['lite', 'cpu', 'cuda'].map(edition => ({
        edition,
        targets: resolveNsisOfflineComponentTargets(edition),
      }));
      fs.writeFileSync(path.join(root, 'editions.json'), JSON.stringify(editions));
      fs.writeFileSync(
        path.join(root, 'Program.cs'),
        `
using System.Reflection;
using System.Text.Json;
using System.Text.Json.Nodes;
using ZhiYuan.Setup.Shell;
var root = args[0];
var method = typeof(InstallerEngine).GetMethod("StepVerifyRuntimeSentinels", BindingFlags.Instance | BindingFlags.NonPublic)!;
using var editions = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, "editions.json")));
foreach (var edition in editions.RootElement.EnumerateArray()) {
    var name = edition.GetProperty("edition").GetString()!;
    var payload = Path.Combine(root, name, "payload");
    var install = Path.Combine(root, name, "app");
    Directory.CreateDirectory(payload);
    var targetsPath = Path.Combine(payload, "component-targets.json");
    var targets = edition.GetProperty("targets").GetRawText();
    File.WriteAllText(targetsPath, targets);
    foreach (var target in edition.GetProperty("targets").EnumerateArray()) {
        var sentinel = Path.Combine(install, "resources", target.GetProperty("sentinel").GetString()!);
        Directory.CreateDirectory(Path.GetDirectoryName(sentinel)!);
        File.WriteAllText(sentinel, "fixture");
    }
    var engine = new InstallerEngine(payload, install, Path.Combine(root, name, "runtime"), Path.Combine(root, name, "data"), false, new Progress<EngineEvent>());
    // ResolvePayloadDirAsync normally publishes this before final verification.
    typeof(InstallerEngine).GetField("payloadDir", BindingFlags.Instance | BindingFlags.NonPublic)!.SetValue(engine, payload);
    method.Invoke(engine, null);
    foreach (var defect in new[] { "missing", "duplicate", "unknown", "sentinel" }) {
        var rows = JsonNode.Parse(targets)!.AsArray();
        string? removed = null;
        if (defect == "missing") rows.RemoveAt(0);
        if (defect == "duplicate") rows.Add(rows[0]!.DeepClone());
        if (defect == "unknown") rows.Add(new JsonObject { ["key"] = "unknown-engine", ["sentinel"] = "unknown/manifest.json" });
        if (defect == "sentinel") {
            removed = Path.Combine(install, "resources", rows[^1]!["sentinel"]!.GetValue<string>());
            File.Delete(removed);
        }
        File.WriteAllText(targetsPath, rows.ToJsonString());
        var rejected = false;
        try { method.Invoke(engine, null); }
        catch (TargetInvocationException ex) when (ex.InnerException is EngineException) { rejected = true; }
        if (!rejected) throw new Exception(name + " accepted " + defect);
        if (removed is not null) File.WriteAllText(removed, "fixture");
    }
    Console.WriteLine("PASS: " + name);
}
`,
      );
      const result = spawnSync(
        dotnet,
        [
          'run',
          '--project',
          path.join(root, 'Probe.csproj'),
          '--configuration',
          'Release',
          '--',
          root,
        ],
        {
          encoding: 'utf8',
          timeout: 110_000,
          env: {
            ...process.env,
            DOTNET_CLI_TELEMETRY_OPTOUT: '1',
            DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
            DOTNET_CLI_HOME: path.join(root, '.dotnet-home'),
          },
        },
      );
      expect(result.status, result.stdout + result.stderr || result.error?.message).toBe(0);
      for (const { edition } of editions) expect(result.stdout).toContain(`PASS: ${edition}`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  120_000,
);
