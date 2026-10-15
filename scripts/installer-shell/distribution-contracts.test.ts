import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';

const root = path.resolve(import.meta.dirname, '../..');
const read = (file: string) => readFileSync(path.join(root, file), 'utf8');

test('community builds keep the full NSIS updater and then assemble the WebView2 installer', () => {
  const { scripts } = JSON.parse(read('package.json'));
  for (const name of ['dist:win:offline', 'dist:win:signed']) {
    expect(scripts[name]).toContain('electron-builder --win nsis --x64');
    expect(scripts[name]).toContain('&& node scripts/installer-shell/build-distribution.cjs');
  }
  expect(scripts['dist:win:signed']).toMatch(/build-distribution\.cjs --signed$/);
  const build = read('scripts/installer-shell/build-distribution.cjs');
  expect(build).not.toContain('sign(uninstall)');
  expect(build.indexOf('verifyRetainedHost(root, uninstall)')).toBeLessThan(
    build.indexOf("'pack-setup.cjs'"),
  );
  expect(build.indexOf('if (signed) sign(setup)')).toBeLessThan(
    build.indexOf('const finalBudget = verifyFinalSetupBudget'),
  );
  expect(build.indexOf('const finalBudget = verifyFinalSetupBudget')).toBeLessThan(
    build.indexOf('const nsisBudget = verifyFinalNsisBudget'),
  );
  expect(build).toContain('finalBudget.componentArchiveBytes');
  expect(build.indexOf('const nsisBudget = verifyFinalNsisBudget')).toBeLessThan(
    build.indexOf('const report = writeSetupManifest'),
  );
  expect(read('electron-builder.windows-signed.cjs')).toContain('forceCodeSigning: true');
  expect(read('scripts/installer-shell/sign-shell.ps1')).toContain(
    'runtime-signing\\sign-runtime.ps1',
  );
  expect(read('scripts/installer-shell/sign-shell.ps1')).toContain('TimeStamperCertificate');
  expect(read('scripts/installer-shell/pack-setup.cjs')).toContain(
    'manifest.components.length !== targets.length',
  );
  expect(read('scripts/installer-shell/pack-setup.cjs')).toContain(
    "path.join(payloadDir, 'uninstall.exe')",
  );
  expect(read('scripts/installer-shell/build-shell.cjs')).not.toContain('ZhiYuanUninstall.exe');
  expect(read('scripts/installer-shell/pack-setup.cjs')).not.toContain(
    "path.join(payloadDir, 'vc_redist.x64.exe')",
  );
  expect(read('scripts/installer-shell/pack-setup.cjs')).toContain('remainingSigningBytes');
  expect(read('scripts/installer-shell/pack-setup.cjs')).toContain(
    'maxNonComponentBytes: MAX_NON_COMPONENT_BYTES',
  );
  expect(read('scripts/installer-shell/pack-setup.cjs')).toContain(
    'assertPayloadDeduplication(payloadDir, uninstallHost)',
  );
  const hook = read('scripts/installer-shell/retain-uninstaller.nsh');
  expect(hook).toContain('!ifdef BUILD_UNINSTALLER');
  expect(hook).toContain('reset "${PROJECT_DIR}"\' = 0');
  expect(hook).toContain('!finalize');
  expect(hook).toContain('"${UNINSTALLER_OUT_FILE}"\' = 0');
});

test.each(['daily-release.yml', 'release-candidate.yml', 'online-update-release.yml'])(
  '%s publishes the final signed, interactively tested shell separately from NSIS updates',
  name => {
    const workflow = read(`.github/workflows/${name}`);
    expect(workflow).toContain('actions/setup-dotnet@v5');
    expect(workflow).toContain('uses: ./.github/actions/setup-certum-signing');
    expect(workflow).toContain('bun run dist:win:signed');
    expect(workflow).toContain('"${installers[0]}:win32:x64:lite:installer"');
    expect(workflow).toContain('"${updaters[0]}:win32:x64:lite:updater"');
    expect(workflow).toContain('"${blockmaps[0]}" == "${updaters[0]}.blockmap"');
    const signed = workflow.indexOf('bun run dist:win:signed');
    const signature = workflow.indexOf('verify-windows-authenticode.ps1');
    const acceptance = workflow.indexOf('node scripts/ci/windows-shell-interactive.mjs');
    const evidence = workflow.indexOf('node scripts/ci/windows-shell-evidence.mjs');
    const prepareUninstall = workflow.indexOf('windows-shell-uninstall.ps1 -Action prepare');
    const verifyUninstall = workflow.indexOf('windows-shell-uninstall.ps1 -Action verify');
    const assembly = workflow.indexOf('installers=(release/ZhiYuanAgent-Setup-*.exe)');
    expect(signature).toBeGreaterThan(signed);
    expect(acceptance).toBeGreaterThan(signature);
    expect(evidence).toBeGreaterThan(acceptance);
    expect(prepareUninstall).toBeGreaterThan(signature);
    expect(prepareUninstall).toBeLessThan(acceptance);
    const nativeSmoke = workflow.indexOf('-File scripts/ci/windows-installer-smoke.ps1');
    if (nativeSmoke >= 0) expect(prepareUninstall).toBeLessThan(nativeSmoke);
    expect(verifyUninstall).toBeGreaterThan(evidence);
    expect(assembly).toBeGreaterThan(verifyUninstall);
    expect(workflow.slice(verifyUninstall, assembly)).toContain(
      "-ExpectedThumbprint '${{ steps.certum-signing.outputs.thumbprint }}'",
    );
    expect(workflow).toContain('path: acceptance-diagnostics\n');
  },
);

test('the internal Windows upload checks real shell evidence without requiring GitHub context', () => {
  const file = path.join(root, 'scripts/ci/package-windows.ps1');
  const script = readFileSync(file, 'utf8');
  expect(readFileSync(file).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(script).toContain("$distWinCommand = 'dist:win:offline'");
  expect(script).not.toContain('dist:win:signed');
  expect(script).toContain('(& git rev-parse HEAD).Trim()');
  expect(script).toContain('$env:ZHIYUAN_SOURCE_COMMIT = $sourceCommit');
  expect(script).toContain('"gitlab-$($env:CI_PIPELINE_ID)-$($env:CI_JOB_ID)"');
  expect(script).toContain('"local-$([Guid]::NewGuid().ToString(\'N\'))"');
  expect(script).toContain('$env:RUNNER_TEMP = $acceptanceRoot');
  expect(script).toContain('$env:RUNNER_TEMP = $previousRunnerTemp');
  const acceptance = script.indexOf('& node scripts/ci/windows-shell-interactive.mjs');
  const evidence = script.indexOf('& node scripts/ci/windows-shell-evidence.mjs');
  const credentials = script.indexOf('if ($env:ARTIFACTORY_USER -and $env:ARTIFACTORY_PASSWORD)');
  const upload = script.indexOf('& curl.exe');
  expect(acceptance).toBeGreaterThan(script.indexOf('$exe = $shells[0]'));
  expect(evidence).toBeGreaterThan(acceptance);
  expect(credentials).toBeGreaterThan(evidence);
  expect(upload).toBeGreaterThan(credentials);
  expect(script.slice(acceptance, evidence)).toContain(
    "throw 'Shell interactive acceptance failed; upload is blocked.'",
  );
  expect(script.slice(evidence, credentials)).toContain(
    "throw 'Shell evidence is invalid; upload is blocked.'",
  );
});

test.skipIf(process.platform !== 'win32')(
  'internal Windows delivery script parses in Windows PowerShell',
  () => {
    const script = path.join(root, 'scripts/ci/package-windows.ps1').replaceAll("'", "''");
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$errors = $null; $null = [System.Management.Automation.Language.Parser]::ParseFile('${script}', [ref]$null, [ref]$errors); if ($errors.Count) { throw ($errors | Out-String) }`,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    expect(result.error, result.stderr).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
  },
);
