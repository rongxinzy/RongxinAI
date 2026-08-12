import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const expectedSidecarRef = '18cccf0898de8fcc2ac20f3a63dd2cc8a0c8bb5f';
const forbiddenRuntimePattern = /openclaw|cfmind/i;
const forbiddenStoragePattern =
  /(?:\.openclaw|openclaw\.json|im_session_mappings|openclaw_session_key|telegramOpenClaw|feishuOpenClaw|dingtalkOpenClaw)/i;
const failures = [];

const productionRoots = [
  'src/common',
  'src/main',
  'src/renderer',
  'src/scheduledTask',
  'src/shared',
];

const buildRoots = ['scripts', 'resources'];
const workflowFiles = [
  '.github/workflows/build-platforms.yml',
  '.github/workflows/online-update-release.yml',
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
    if (/\.test\.[cm]?[jt]sx?$/i.test(relativePath)) continue;
    if (/[/\\]design\.md$/i.test(relativePath)) continue;
    checkFile(relativePath, [forbiddenRuntimePattern, forbiddenStoragePattern]);
  }
}

for (const buildRoot of buildRoots) {
  for (const relativePath of walk(buildRoot)) {
    if (relativePath.endsWith('check-openclaw-decoupling.mjs')) continue;
    checkFile(relativePath, [forbiddenRuntimePattern, forbiddenStoragePattern]);
  }
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if ('openclaw' in packageJson) failures.push('package.json contains retired runtime metadata');
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

checkFile('electron-builder.json', [forbiddenRuntimePattern, forbiddenStoragePattern]);
checkFile('vite.config.ts', [forbiddenRuntimePattern, forbiddenStoragePattern]);

for (const workflowFile of workflowFiles) {
  const content = fs.readFileSync(path.join(root, workflowFile), 'utf8');
  const refs = [
    ...content.matchAll(/repository:\s*rongxinzy\/pi-connect[\s\S]{0,180}?ref:\s*([^\s]+)/g),
  ];
  if (refs.length !== 1 || refs[0][1] !== expectedSidecarRef) {
    failures.push(`${workflowFile} must pin pi-connect to ${expectedSidecarRef}`);
  }
  const contentWithoutGateCommand = content
    .split(/\r?\n/)
    .filter(line => !line.includes('check-openclaw-decoupling'))
    .join('\n');
  if (forbiddenRuntimePattern.test(contentWithoutGateCommand)) {
    failures.push(`${workflowFile} contains retired runtime build or cache logic`);
  }
}

if (failures.length > 0) {
  console.error('[DecouplingCheck] Failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(
  '[DecouplingCheck] Pi execution, cc-connect transport, and SQLite ownership boundaries are intact.',
);
