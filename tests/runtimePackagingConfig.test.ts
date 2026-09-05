import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { prerelease } from "semver";
import { test } from "vitest";

const root = path.resolve(__dirname, "..");

function resourceSources(config: {
  extraResources?: Array<{ from?: string }>;
}): string[] {
  return (config.extraResources || []).flatMap((item) =>
    typeof item.from === "string" ? [item.from] : [],
  );
}

test("each desktop target keeps the private document and Python toolchain resources", () => {
  const config = JSON.parse(
    readFileSync(path.join(root, "electron-builder.json"), "utf8"),
  ) as {
    mac: { extraResources?: Array<{ from?: string }> };
    linux: { extraResources?: Array<{ from?: string }> };
    win: { extraResources?: Array<{ from?: string }> };
  };
  const mac = resourceSources(config.mac);
  const linux = resourceSources(config.linux);

  assert.deepEqual(
    [
      "resources/uv-mac",
      "resources/python-mac",
      "resources/skill-python",
    ].every((source) => mac.includes(source)),
    true,
  );
  assert.deepEqual(
    [
      "resources/uv-linux",
      "resources/python-linux",
      "resources/skill-python",
    ].every((source) => linux.includes(source)),
    true,
  );

  // Windows puts large resources in independently reusable component archives.
  const windowsResourcePack = readFileSync(
    path.join(root, "scripts", "windows-resource-pack.cjs"),
    "utf8",
  );
  for (const resource of ["mingit", "python-win", "skill-python", "uv-win"]) {
    assert.match(
      windowsResourcePack,
      new RegExp(`prefix: ["']${resource}["']`),
    );
  }
});

test("unpacks AnyDoc native bindings from the application archive", () => {
  const config = JSON.parse(
    readFileSync(path.join(root, "electron-builder.json"), "utf8"),
  ) as {
    asarUnpack?: string[];
  };
  assert.ok(config.asarUnpack?.includes("node_modules/@firecrawl/**"));

  const viteConfig = readFileSync(path.join(root, "vite.config.ts"), "utf8");
  const runtimeDependencies = readFileSync(
    path.join(root, "scripts", "electron-runtime-dependencies.mjs"),
    "utf8",
  );
  assert.match(
    viteConfig,
    /ELECTRON_MAIN_EXTERNALS\.includes\(id\)/,
  );
  assert.match(
    runtimeDependencies,
    /ELECTRON_MAIN_EXTERNALS\s*=\s*\[[\s\S]*['"]@firecrawl\/anydoc['"]/,
  );
});

test("unpacks npm for connector installation without a system Node.js runtime", () => {
  const config = JSON.parse(
    readFileSync(path.join(root, "electron-builder.json"), "utf8"),
  ) as {
    asarUnpack?: string[];
  };

  assert.ok(config.asarUnpack?.includes("node_modules/npm/**"));
});

test("unpacks ACP adapters without bundling external agent binaries", () => {
  const config = JSON.parse(
    readFileSync(path.join(root, "electron-builder.json"), "utf8"),
  ) as {
    files?: string[];
    asarUnpack?: string[];
  };

  assert.ok(
    config.asarUnpack?.includes(
      "node_modules/@agentclientprotocol/codex-acp/**",
    ),
  );
  assert.ok(
    config.asarUnpack?.includes(
      "node_modules/@agentclientprotocol/claude-agent-acp/**",
    ),
  );
  assert.ok(
    config.asarUnpack?.includes(
      "node_modules/@anthropic-ai/claude-agent-sdk/**",
    ),
  );
  assert.ok(config.asarUnpack?.includes("node_modules/zod/**"));
  assert.ok(!config.asarUnpack?.includes("node_modules/@anthropic-ai/**"));
  assert.ok(!config.asarUnpack?.includes("node_modules/@agentclientprotocol/**"));
  assert.ok(!config.asarUnpack?.includes("node_modules/@openai/**"));
  assert.ok(config.files?.includes("!node_modules/zod/src/**"));

  for (const platform of ["darwin", "linux", "win32"]) {
    assert.ok(
      config.files?.includes(
        `!node_modules/@anthropic-ai/claude-agent-sdk-${platform}-*/**`,
      ),
    );
    assert.ok(
      config.files?.includes(`!node_modules/@openai/codex-${platform}-*/**`),
    );
  }
});

test("stable release metadata does not inherit the build prerelease channel", () => {
  const config = JSON.parse(
    readFileSync(path.join(root, "electron-builder.json"), "utf8"),
  ) as {
    detectUpdateChannel?: boolean;
    linux?: { publish?: Array<{ url?: string }> };
    mac?: { publish?: Array<{ url?: string }> };
    win?: { publish?: Array<{ url?: string }> };
  };

  assert.deepEqual(prerelease("2026.8.6-build.1"), ["build", 1]);
  assert.equal(config.detectUpdateChannel, false);
  for (const target of [config.win, config.mac, config.linux]) {
    assert.match(target?.publish?.[0]?.url || "", /\/v2\/electron\/stable\//);
  }
});

test("publish verification uses portable jq flags and preserves updater filenames per target", () => {
  const workflow = readFileSync(
    path.join(root, ".github", "workflows", "online-update-release.yml"),
    "utf8",
  );
  assert.match(workflow, /jq -s -r/);
  assert.doesNotMatch(workflow, /jq -rsr/);
  assert.match(
    workflow,
    /output="manifest\/electron\/\$\{target_file\}\/\$\{filename\}"/,
  );
  assert.match(
    workflow,
    /manifest\/electron\/win32-x64-lite\/latest\.yml:win32:x64:lite/,
  );
  assert.match(
    workflow,
    /manifest\/electron\/darwin-arm64-default\/latest-mac\.yml:darwin:arm64:default/,
  );
  assert.match(
    workflow,
    /manifest\/electron\/linux-x64-appimage\/latest-linux\.yml:linux:x64:appimage/,
  );
  assert.match(
    workflow,
    /manifest\/electron\/linux-x64-deb\/latest-linux\.yml:linux:x64:deb/,
  );
});

test("release supply-chain gates track every checked-in npm lockfile", () => {
  const trackedLockfiles = execFileSync(
    "git",
    ["ls-files", "*package-lock.json"],
    { cwd: root, encoding: "utf8" },
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .sort();
  const policy = readFileSync(
    path.join(root, "scripts", "ci", "check-supply-chain-inputs.mjs"),
    "utf8",
  );
  const workflow = readFileSync(
    path.join(root, ".github", "workflows", "online-update-release.yml"),
    "utf8",
  );
  const policyLockfiles = Array.from(
    policy.matchAll(/^\s+'([^']+package-lock\.json)',?$/gm),
    (match) => match[1],
  ).sort();
  const signatureStep = workflow.slice(
    workflow.indexOf("- name: Verify npm package signatures"),
    workflow.indexOf("- name: Enforce approved package sources"),
  );
  const workflowLockfiles = Array.from(
    signatureStep.matchAll(/^\s+([^\s]+package-lock\.json)(?: \\|; do)?$/gm),
    (match) => match[1],
  ).sort();

  assert.deepEqual(policyLockfiles, trackedLockfiles);
  assert.deepEqual(workflowLockfiles, trackedLockfiles);
});

test("unsigned macOS release builds do not receive empty signing credentials", () => {
  const workflow = readFileSync(
    path.join(root, ".github", "workflows", "online-update-release.yml"),
    "utf8",
  );
  const unsignedStart = workflow.indexOf(
    "- name: Build unsigned macOS package",
  );
  const signedStart = workflow.indexOf("- name: Build signed macOS package");
  const verifyStart = workflow.indexOf(
    "- name: Verify signed and notarized macOS app",
  );

  assert.ok(
    unsignedStart >= 0 &&
      signedStart > unsignedStart &&
      verifyStart > signedStart,
  );
  const unsignedStep = workflow.slice(unsignedStart, signedStart);
  const signedStep = workflow.slice(signedStart, verifyStart);
  assert.match(unsignedStep, /ZHIYUAN_MAC_AUTO_UPDATE_ENABLED != 'true'/);
  assert.doesNotMatch(
    unsignedStep,
    /CSC_LINK|CSC_KEY_PASSWORD|APPLE_ID|APPLE_APP_SPECIFIC_PASSWORD|APPLE_TEAM_ID/,
  );
  assert.match(signedStep, /ZHIYUAN_MAC_AUTO_UPDATE_ENABLED == 'true'/);
  assert.match(signedStep, /CSC_LINK:[\s\S]*APPLE_TEAM_ID:/);
});

test("release workflows explicitly provision the private POSIX toolchain", () => {
  for (const workflow of ["build-platforms.yml", "online-update-release.yml"]) {
    const content = readFileSync(
      path.join(root, ".github", "workflows", workflow),
      "utf8",
    );
    assert.match(content, /bun run setup:posix-uv-runtime/);
    assert.match(content, /bun run setup:posix-python-runtime/);
    assert.doesNotMatch(content, /setup:pandoc-runtime/);
  }
});

test("Windows release workflow runs the clean-path bundled runtime gate", () => {
  for (const workflowName of [
    "build-platforms.yml",
    "online-update-release.yml",
  ]) {
    const workflow = readFileSync(
      path.join(root, ".github", "workflows", workflowName),
      "utf8",
    );
    assert.match(workflow, /windows-runtime-smoke\.ps1/);
  }
  const smoke = readFileSync(
    path.join(root, "scripts", "ci", "windows-runtime-smoke.ps1"),
    "utf8",
  );
  assert.match(smoke, /skill-python\\layers\\shared\\Scripts\\python\.exe/);
  assert.doesNotMatch(smoke, /skill-python\\(?:xlsx|pdf)\\Scripts\\python\.exe/);
  assert.match(smoke, /bundled XLSX dependency probe/);
  assert.match(smoke, /bundled PDF dependency probe/);
  assert.match(smoke, /markdown_to_docx\.mjs/);
  assert.match(smoke, /docx\\scripts\\markdown_to_docx\.mjs/);
  assert.match(smoke, /electron-builder\.json/);
  assert.match(smoke, /release\\win-unpacked/);
  assert.match(smoke, /packaged Electron Node runtime/);
  assert.doesNotMatch(smoke, /node_modules\\electron\\dist\\electron\.exe/);
  assert.match(smoke, /ELECTRON_RUN_AS_NODE/);
  assert.match(smoke, /Start-Process[\s\S]*-Wait[\s\S]*-PassThru/);
  assert.match(smoke, /DOCX Markdown conversion/);
  assert.match(smoke, /validate-docx-smoke\.mjs/);
  assert.match(smoke, /generated DOCX validation/);
  assert.doesNotMatch(smoke, /Invoke-Checked \$electron/);
  assert.match(smoke, /External command unexpectedly remains discoverable/);
  assert.match(smoke, /mingit\\usr\\bin\\bash\.exe/);
  assert.match(smoke, /PATH = "\$env:SystemRoot\\System32;\$env:SystemRoot"/);
  const packageScript = readFileSync(
    path.join(root, "scripts", "ci", "package-windows.ps1"),
    "utf8",
  );
  assert.match(packageScript, /windows-runtime-smoke\.ps1/);
});

test("protected Windows releases authenticate with Certum and require valid signatures", () => {
  const packageJson = JSON.parse(
    readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { scripts: Record<string, string> };
  assert.match(
    packageJson.scripts["dist:win:signed"],
    /electron-builder\.windows-signed\.cjs/,
  );
  assert.match(packageJson.scripts["dist:win:offline"], /electron-builder\.json/);

  for (const workflowName of [
    "online-update-release.yml",
    "release-candidate.yml",
  ]) {
    const workflow = readFileSync(
      path.join(root, ".github", "workflows", workflowName),
      "utf8",
    );
    assert.match(workflow, /\.\/\.github\/actions\/setup-certum-signing/);
    assert.match(workflow, /bun run dist:win:signed/);
    assert.match(workflow, /CERTUM_CERT_THUMBPRINT:/);
    assert.match(workflow, /verify-windows-authenticode\.ps1/);
  }

  const setupAction = readFileSync(
    path.join(
      root,
      ".github",
      "actions",
      "setup-certum-signing",
      "action.yml",
    ),
    "utf8",
  );
  assert.match(
    setupAction,
    /dismine\/windows-app-signing-setup-action@[0-9a-f]{40}/,
  );
  assert.match(setupAction, /SimplySignDesktop-9\.4\.3\.90-64-bit-en\.msi/);
  assert.match(setupAction, /SignerCertificate\.Subject[\s\S]*Asseco Data Systems/);
  assert.match(setupAction, /capture-diagnostics: false/);

  const signedConfigPath = path.join(
    root,
    "electron-builder.windows-signed.cjs",
  );
  const signedConfig = JSON.parse(
    execFileSync(
      process.execPath,
      [
        "-e",
        "const c=require(process.argv[1]); process.stdout.write(JSON.stringify(c.win.signtoolOptions));",
        signedConfigPath,
      ],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CERTUM_CERT_THUMBPRINT: "0123456789abcdef0123456789abcdef01234567",
        },
      },
    ),
  ) as {
    certificateSha1: string;
    signingHashAlgorithms: string[];
    rfc3161TimeStampServer: string;
  };
  assert.equal(
    signedConfig.certificateSha1,
    "0123456789ABCDEF0123456789ABCDEF01234567",
  );
  assert.deepEqual(signedConfig.signingHashAlgorithms, ["sha256"]);
  assert.equal(signedConfig.rfc3161TimeStampServer, "http://time.certum.pl");

  const signatureVerifier = readFileSync(
    path.join(root, "scripts", "ci", "verify-windows-authenticode.ps1"),
    "utf8",
  );
  assert.match(
    signatureVerifier,
    /electron-builder\.json'[\s\S]*-Raw -Encoding UTF8 \| ConvertFrom-Json/,
  );
});

test("installer-related pull requests build and exercise the Windows installer", () => {
  const workflow = readFileSync(
    path.join(root, ".github", "workflows", "windows-installer-pr.yml"),
    "utf8",
  );
  assert.match(workflow, /workflow_call:/);
  assert.doesNotMatch(workflow, /pull_request:/);
  assert.doesNotMatch(workflow, /paths:/);
  assert.match(workflow, /runs-on: windows-latest/);
  assert.match(workflow, /@\('run', 'dist:win:offline'\)/);
  assert.match(workflow, /windows-runtime-smoke\.ps1/);
  assert.match(workflow, /windows-installer-size-smoke\.ps1/);
  assert.match(workflow, /windows-installer-smoke\.ps1/);

  const smoke = readFileSync(
    path.join(root, "scripts", "ci", "windows-installer-smoke.ps1"),
    "utf8",
  );
  assert.match(smoke, /'cold installation'/);
  assert.match(smoke, /'cache-hit upgrade'/);
  assert.match(smoke, /phase=component-cache-miss/);
  assert.match(smoke, /phase=component-cache-hit/);
  assert.doesNotMatch(smoke, /phase=defender-exclusion/);
  assert.match(smoke, /'uninstall'/);

  const sizeSmoke = readFileSync(
    path.join(root, "scripts", "ci", "windows-installer-size-smoke.ps1"),
    "utf8",
  );
  assert.match(sizeSmoke, /\$_\.archiveSizeBytes/);
  assert.doesNotMatch(sizeSmoke, /\$_\.archiveBytes\b/);
  assert.match(sizeSmoke, /component archive bytes/);
  assert.match(sizeSmoke, /MaximumInstallerBytes = 315MB/);
  assert.match(sizeSmoke, /MaximumComponentBytes = 165MB/);
  assert.match(sizeSmoke, /MaximumNonComponentBytes = 150MB/);
});

test("manual release candidates preserve immutable artifacts without publishing them", () => {
  const workflow = readFileSync(
    path.join(root, ".github", "workflows", "release-candidate.yml"),
    "utf8",
  );

  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /release_version:/);
  assert.match(workflow, /source_ref:/);
  assert.match(workflow, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /APP_BUILD_VERSION:/);
  assert.match(workflow, /create-release-candidate\.mjs/);
  assert.match(workflow, /verify-release-candidate\.mjs/);
  assert.match(workflow, /windows-installer-size-smoke\.ps1/);
  assert.match(workflow, /windows-installer-smoke\.ps1/);
  assert.match(workflow, /retention-days: 7/);
  assert.doesNotMatch(workflow, /R2_(?:BUCKET|ACCESS_KEY)/);
  assert.doesNotMatch(workflow, /CLOUDFLARE_ACCOUNT_ID/);
  assert.doesNotMatch(workflow, /aws s3/);
  assert.doesNotMatch(workflow, /upload-update-artifacts\.mjs/);
});

test("manual candidate promotion verifies exact artifacts before protected publication", () => {
  const workflowPath = path.join(
    root,
    ".github",
    "workflows",
    "release-candidate-promotion.yml",
  );
  const workflowText = readFileSync(workflowPath, "utf8");
  const preflightStart = workflowText.indexOf("  preflight:");
  const promoteStart = workflowText.indexOf("  promote:");
  assert.ok(preflightStart >= 0 && promoteStart > preflightStart);
  const preflight = workflowText.slice(preflightStart, promoteStart);
  const promote = workflowText.slice(promoteStart);

  assert.match(workflowText, /workflow_dispatch:/);
  assert.match(workflowText, /candidate_run_id:/);
  assert.match(workflowText, /release_version:/);
  assert.match(workflowText, /source_commit:/);
  assert.match(promote, /needs: preflight/);
  assert.match(promote, /environment: release/);
  assert.match(promote, /ref: main/);
  assert.match(preflight, /release-candidate\.yml/);
  assert.match(preflight, /workflow_dispatch/);
  assert.match(preflight, /head_branch.*main/);
  assert.match(preflight, /run-id/);
  assert.match(preflight, /verify-release-candidate\.mjs/);
  assert.doesNotMatch(
    preflight,
    /R2_ACCESS_KEY_ID|R2_SECRET_ACCESS_KEY|aws s3/,
  );
  assert.match(promote, /run-id/);
  assert.match(promote, /Configure protected R2 access/);
  assert.ok(
    promote.indexOf("Configure protected R2 access") >
      promote.lastIndexOf("actions/download-artifact@v8"),
  );
  assert.match(promote, /upload-release-candidate\.mjs/);
  assert.match(promote, /publish-update-manifest\.mjs/);
  assert.match(
    promote,
    /UPDATE_SOURCE_PIPELINE_ID: \$\{\{ inputs\.candidate_run_id \}\}/,
  );
  assert.match(promote, /--if-none-match/);
  assert.match(promote, /--if-match/);
  assert.match(promote, /verify-published-update\.mjs/);

  const uploader = readFileSync(
    path.join(root, "scripts", "release", "upload-release-candidate.mjs"),
    "utf8",
  );
  assert.match(uploader, /verifyCandidateManifests/);
  assert.match(
    uploader,
    /Immutable object already exists with different content/,
  );

  const tagRelease = readFileSync(
    path.join(root, ".github", "workflows", "online-update-release.yml"),
    "utf8",
  );
  assert.match(tagRelease, /tags:/);
  assert.match(tagRelease, /publish-update-manifest\.mjs/);
});

test("DOCX smoke validator accepts the bundled Markdown converter output", () => {
  const workspace = mkdtempSync(path.join(tmpdir(), "zhiyuan-docx-smoke-"));
  const markdown = path.join(workspace, "smoke.md");
  const docx = path.join(workspace, "smoke.docx");
  try {
    writeFileSync(
      markdown,
      "# Runtime smoke\n\nPackaged Electron conversion works.\n",
    );
    execFileSync(
      process.execPath,
      [
        path.join(root, "SKILLs", "docx", "scripts", "markdown_to_docx.mjs"),
        markdown,
        docx,
      ],
      { stdio: "pipe" },
    );
    execFileSync(
      process.execPath,
      [path.join(root, "scripts", "ci", "validate-docx-smoke.mjs"), docx],
      {
        stdio: "pipe",
      },
    );
    assert.equal(existsSync(docx), true);
    assert.ok(statSync(docx).size > 0);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
