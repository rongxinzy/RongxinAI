import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  durableManifestViolations,
  retiredExecutionReferencePattern,
  retiredPackagingReferencePattern,
} from '../packaging/retired-runtime-policy.cjs';
import { isPinnedMagpieGatewayBinary } from './magpie-gateway-allowlist.mjs';

const root = process.cwd();
const forbiddenRuntimePattern = /openclaw|cfmind/i;
const forbiddenStoragePattern =
  /(?:\.openclaw|openclaw\.json|im_session_mappings|openclaw_session_key|telegramOpenClaw|feishuOpenClaw|dingtalkOpenClaw)/i;
const forbiddenBrandingPattern = /龙虾|clawEmail|popo\.png|moltbot|DING_DWS_CLAW/i;
const failures = [];

const productionRoots = [
  'src/common',
  'src/main',
  'src/renderer',
  'src/scheduledTask',
  'src/shared',
];

const brandingScanRoots = [...productionRoots, 'SKILLs', 'public'];
const forbiddenPublicAssets = ['public/popo.png', 'public/love.png', 'public/hand.png'];

const buildRoots = ['scripts', 'resources'];
const workflowFiles = [
  '.github/workflows/linux-install-pr.yml',
  '.github/workflows/release.yml',
  '.github/workflows/windows-installer-pr.yml',
];

const forbiddenPaths = [
  '.github/workflows/openclaw-check.yml',
  'openclaw-extensions',
  'resources/openclaw-bootstrap',
  'scripts/patches',
  'src/shared/openclaw',
  'src/main/openclawSession',
  'src/main/openclawSessionPolicy',
  'package-lock.json',
];

function walk(relativeRoot) {
  const absoluteRoot = path.join(root, relativeRoot);
  if (!fs.existsSync(absoluteRoot)) return [];
  const result = [];
  for (const entry of fs.readdirSync(absoluteRoot, { withFileTypes: true })) {
    const relativePath = path.join(relativeRoot, entry.name);
    if (entry.isDirectory()) {
      result.push(...walk(relativePath));
    } else {
      result.push(relativePath);
    }
  }
  return result;
}

function checkFile(relativePath, patterns) {
  // The pinned gateway executable is an unchanged Go build. Upstream's provider
  // importer links the CC Switch app label "openclaw" ("OpenClaw") into the
  // binary next to other external coding-agent names. Reading those bytes as
  // text matches the retired-runtime pattern even though this tree does not
  // ship that runtime, its storage, or its connectors. "cfmind" is not in the
  // pinned source. Exempt only the expected binary path when the manifest pins
  // upstream.json's version and commit and the hash is the compiler digest.
  if (isPinnedMagpieGatewayBinary(root, relativePath)) return;
  const content = fs.readFileSync(path.join(root, relativePath), 'utf8');
  for (const pattern of patterns) {
    if (pattern.test(content)) {
      failures.push(`${relativePath} contains retired runtime or storage references`);
      return;
    }
  }
}

for (const relativePath of forbiddenPaths) {
  const absolutePath = path.join(root, relativePath);
  const containsFiles =
    fs.existsSync(absolutePath) &&
    (fs.statSync(absolutePath).isFile() || walk(relativePath).length > 0);
  if (containsFiles) {
    failures.push(`${relativePath} must not exist`);
  }
}

for (const sourceRoot of productionRoots) {
  for (const relativePath of walk(sourceRoot)) {
    if (/\.test(?:Harness)?\.[cm]?[jt]sx?$/i.test(relativePath)) continue;
    if (/[/\\]design\.md$/i.test(relativePath)) continue;
    checkFile(relativePath, [
      forbiddenRuntimePattern,
      forbiddenStoragePattern,
      retiredExecutionReferencePattern,
    ]);
  }
}

for (const buildRoot of buildRoots) {
  for (const relativePath of walk(buildRoot)) {
    if (
      relativePath.endsWith('check-openclaw-decoupling.mjs') ||
      relativePath.endsWith('retired-runtime-policy.cjs') ||
      /\.test\.[cm]?[jt]sx?$/i.test(relativePath) ||
      /\.md$/i.test(relativePath)
    )
      continue;
    checkFile(relativePath, [forbiddenRuntimePattern, forbiddenStoragePattern]);
  }
}

for (const sourceRoot of brandingScanRoots) {
  for (const relativePath of walk(sourceRoot)) {
    if (/\.test\.[cm]?[jt]sx?$/i.test(relativePath)) continue;
    if (/[/\\]design\.md$/i.test(relativePath)) continue;
    checkFile(relativePath, [forbiddenBrandingPattern]);
  }
}

for (const relativePath of forbiddenPublicAssets) {
  if (fs.existsSync(path.join(root, relativePath))) {
    failures.push(`${relativePath} must not exist`);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if ('openclaw' in packageJson) failures.push('package.json contains retired runtime metadata');
failures.push(
  ...durableManifestViolations(packageJson, fs.readFileSync(path.join(root, 'bun.lock'), 'utf8')),
);
for (const [name, command] of Object.entries(packageJson.scripts ?? {})) {
  if (name === 'check:openclaw-decoupling') continue;
  if (forbiddenRuntimePattern.test(`${name} ${command}`)) {
    failures.push(`package.json script ${name} references the retired runtime`);
  }
}
for (const dependencyGroup of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  for (const dependencyName of Object.keys(packageJson[dependencyGroup] ?? {})) {
    if (forbiddenRuntimePattern.test(dependencyName)) {
      failures.push(`package.json dependency ${dependencyName} references the retired runtime`);
    }
  }
}

for (const relativePath of fs
  .readdirSync(root)
  .filter(file => /^electron-builder.*\.(?:json|cjs)$/.test(file)))
  checkFile(relativePath, [
    forbiddenRuntimePattern,
    forbiddenStoragePattern,
    retiredPackagingReferencePattern,
  ]);
checkFile('vite.config.ts', [forbiddenRuntimePattern, forbiddenStoragePattern]);

for (const workflowFile of workflowFiles) {
  const content = fs.readFileSync(path.join(root, workflowFile), 'utf8');
  const magpieGatewayReleaseBuild =
    workflowFile === '.github/workflows/release.yml' && /magpie:build/.test(content);
  // Installation preflight builds the same pinned gateway as signed releases.
  // This toolchain is independent of the application execution runtime.
  const pinnedMagpieGatewayBuild =
    /resources\/magpie\/upstream\.json/.test(content) &&
    /bun run magpie:build -- --target (?:linux|win32)-x64/.test(content) &&
    /bun run magpie:verify -- --target (?:linux|win32)-x64/.test(content) &&
    /go-version: \$\{\{ steps\.magpie-toolchain\.outputs\.go-version \}\}/.test(content);
  const forbiddenGoSetup =
    /actions\/setup-go/.test(content) && !magpieGatewayReleaseBuild && !pinnedMagpieGatewayBuild;
  if (
    /repository:\s*rongxinzy\/pi-connect|ZHIYUAN_CC_CONNECT_SOURCE/.test(content) ||
    forbiddenGoSetup
  ) {
    failures.push(`${workflowFile} must not build retired transport sources`);
  }
  const contentWithoutGateCommand = content
    .split(/\r?\n/)
    .filter(line => !line.includes('check-openclaw-decoupling'))
    .join('\n');
  if (forbiddenRuntimePattern.test(contentWithoutGateCommand)) {
    failures.push(`${workflowFile} contains retired runtime build or cache logic`);
  }
}

for (const directory of ['scripts', '.github']) {
  for (const relativePath of walk(directory)) {
    if (
      relativePath.endsWith('check-openclaw-decoupling.mjs') ||
      relativePath.endsWith('retired-runtime-policy.cjs') ||
      /\.test\.[cm]?[jt]sx?$/i.test(relativePath) ||
      /\.md$/i.test(relativePath)
    )
      continue;
    checkFile(relativePath, [retiredPackagingReferencePattern]);
  }
}

if (failures.length > 0) {
  console.error('[DecouplingCheck] Failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  '[DecouplingCheck] Durable execution, native automations, and Markdown plugin memory boundaries are intact.',
);
await import('../vendor-memory-markdown.mjs');
