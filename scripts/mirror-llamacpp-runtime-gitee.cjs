'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const {
  resolveGitHubRepo,
  resolveOfficialRuntimeCompanionAssetNames,
  resolveOfficialRuntimeAssetName,
  resolveRuntimeReleaseTag,
} = require('./download-llamacpp-runtime.cjs');

const DEFAULT_GITEE_OWNER = 'wanghaozhe1106';
const DEFAULT_GITEE_REPO = 'llama.cpp-runtime';
const DEFAULT_GITEE_API_BASE = 'https://gitee.com/api/v5';
const DEFAULT_GITEE_TARGET_COMMITISH = 'master';
const DEFAULT_API_RETRY_COUNT = 5;
const DEFAULT_API_RETRY_DELAY_MS = 5000;

function parseArgs(argv) {
  const options = {
    targets: [],
    dryRun: false,
    upload: false,
    force: false,
    outputDir: '',
    tag: '',
    githubRepo: '',
    giteeOwner: process.env.GITEE_OWNER || DEFAULT_GITEE_OWNER,
    giteeRepo: process.env.GITEE_REPO || DEFAULT_GITEE_REPO,
    giteeApiBase: process.env.GITEE_API_BASE || DEFAULT_GITEE_API_BASE,
    giteeTargetCommitish: process.env.GITEE_TARGET_COMMITISH || DEFAULT_GITEE_TARGET_COMMITISH,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--all') {
      options.targets = ['all'];
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--upload') {
      options.upload = true;
      continue;
    }
    if (arg === '--force') {
      options.force = true;
      continue;
    }
    if (arg === '--target' || arg === '--targets') {
      options.targets.push(...readNext(argv, ++index, arg).split(',').map(item => item.trim()).filter(Boolean));
      continue;
    }
    if (arg === '--output-dir') {
      options.outputDir = readNext(argv, ++index, arg);
      continue;
    }
    if (arg === '--tag') {
      options.tag = readNext(argv, ++index, arg);
      continue;
    }
    if (arg === '--github-repo') {
      options.githubRepo = readNext(argv, ++index, arg);
      continue;
    }
    if (arg === '--gitee-owner') {
      options.giteeOwner = readNext(argv, ++index, arg);
      continue;
    }
    if (arg === '--gitee-repo') {
      options.giteeRepo = readNext(argv, ++index, arg);
      continue;
    }
    if (arg === '--gitee-api-base') {
      options.giteeApiBase = readNext(argv, ++index, arg);
      continue;
    }
    if (arg === '--gitee-target-commitish') {
      options.giteeTargetCommitish = readNext(argv, ++index, arg);
      continue;
    }
    if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function readNext(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printHelp() {
  console.log([
    'Usage:',
    '  node scripts/mirror-llamacpp-runtime-gitee.cjs --all [--upload]',
    '  node scripts/mirror-llamacpp-runtime-gitee.cjs --targets win-x64,win-x64-cuda-12 --upload',
    '',
    'Environment for upload:',
    '  GITEE_TOKEN       Gitee personal access token with release permissions',
    '  GITEE_OWNER       Gitee namespace, default wanghaozhe1106',
    '  GITEE_REPO        Gitee repository, default llama.cpp-runtime',
    '  GITEE_API_BASE    API base, default https://gitee.com/api/v5',
    '  GITEE_TARGET_COMMITISH  Release target branch/commit, default master',
  ].join('\n'));
}

function readPackageJson(rootDir) {
  return JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
}

function resolveTargets(rootDir, requestedTargets) {
  const assets = readPackageJson(rootDir).llamacpp?.runtimeAssets ?? {};
  const allTargets = Object.keys(assets);
  if (requestedTargets.length === 0 || requestedTargets.includes('all')) {
    return allTargets;
  }
  for (const target of requestedTargets) {
    if (!assets[target]) {
      throw new Error(`Unknown llama.cpp runtime target: ${target}`);
    }
  }
  return Array.from(new Set(requestedTargets));
}

function buildMirrorPlan(rootDir, options) {
  const env = {
    ...process.env,
    ...(options.tag ? { LLAMACPP_RUNTIME_RELEASE_TAG: options.tag } : {}),
    ...(options.githubRepo ? { LLAMACPP_RUNTIME_GITHUB_REPO: options.githubRepo } : {}),
  };
  const tag = resolveRuntimeReleaseTag(rootDir, env);
  const githubRepo = resolveGitHubRepo(env);
  const outputDir = path.resolve(options.outputDir || path.join(rootDir, 'dist', 'llamacpp-runtime-mirror', tag));
  const targets = resolveTargets(rootDir, options.targets);
  const assets = targets.flatMap(targetId => {
    const assetName = resolveOfficialRuntimeAssetName(targetId, env);
    const companionAssetNames = resolveOfficialRuntimeCompanionAssetNames(targetId, env);
    return [assetName, ...companionAssetNames].map((name, index) => ({
      targetId,
      role: index === 0 ? 'runtime' : 'companion',
      assetName: name,
      upstreamUrl: `https://github.com/${githubRepo}/releases/download/${tag}/${name}`,
      localPath: path.join(outputDir, name),
    }));
  });
  return {
    tag,
    githubRepo,
    outputDir,
    giteeOwner: options.giteeOwner,
    giteeRepo: options.giteeRepo,
    giteeApiBase: options.giteeApiBase.replace(/\/$/, ''),
    giteeTargetCommitish: options.giteeTargetCommitish,
    assets,
  };
}

async function downloadAsset(asset, options) {
  if (fs.existsSync(asset.localPath) && !options.force) {
    console.log(`[mirror-llamacpp-runtime] Reusing ${asset.localPath}`);
    return;
  }
  if (options.dryRun) {
    console.log(`[mirror-llamacpp-runtime] Would download ${asset.upstreamUrl}`);
    return;
  }

  console.log(`[mirror-llamacpp-runtime] Downloading ${asset.upstreamUrl}`);
  const response = await fetch(asset.upstreamUrl, {
    headers: { 'User-Agent': 'RongxinAI/llamacpp-runtime-mirror' },
  });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed: HTTP ${response.status} ${response.statusText} (${asset.upstreamUrl})`);
  }

  fs.mkdirSync(path.dirname(asset.localPath), { recursive: true });
  const tempPath = `${asset.localPath}.download`;
  const file = fs.createWriteStream(tempPath);
  const reader = response.body.getReader();
  const total = Number(response.headers.get('content-length') || 0);
  let downloaded = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      downloaded += value.byteLength;
      if (!file.write(Buffer.from(value))) {
        await new Promise(resolve => file.once('drain', resolve));
      }
      if (total > 0) {
        process.stdout.write(`\r[mirror-llamacpp-runtime] ${asset.assetName} ${Math.floor((downloaded / total) * 100)}%`);
      }
    }
  } finally {
    await new Promise(resolve => file.end(resolve));
  }
  if (total > 0) process.stdout.write('\n');
  fs.renameSync(tempPath, asset.localPath);
}

function writeManifest(plan, options) {
  if (options.dryRun) return;
  const manifest = {
    tag: plan.tag,
    githubRepo: plan.githubRepo,
    gitee: {
      owner: plan.giteeOwner,
      repo: plan.giteeRepo,
      releaseUrl: `https://gitee.com/${plan.giteeOwner}/${plan.giteeRepo}/releases/tag/${plan.tag}`,
    },
    generatedAt: new Date().toISOString(),
    assets: plan.assets.map(asset => ({
      targetId: asset.targetId,
      role: asset.role,
      assetName: asset.assetName,
      upstreamUrl: asset.upstreamUrl,
      size: fs.existsSync(asset.localPath) ? fs.statSync(asset.localPath).size : 0,
      sha256: fs.existsSync(asset.localPath) ? sha256File(asset.localPath) : '',
    })),
  };
  fs.mkdirSync(plan.outputDir, { recursive: true });
  fs.writeFileSync(
    path.join(plan.outputDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
}

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

async function uploadAssets(plan, options) {
  if (!options.upload) return;
  const token = process.env.GITEE_TOKEN;
  if (!token) {
    throw new Error('Missing GITEE_TOKEN. Set it before running with --upload.');
  }
  if (options.dryRun) {
    console.log(`[mirror-llamacpp-runtime] Would upload ${plan.assets.length} asset(s) to ${plan.giteeOwner}/${plan.giteeRepo}@${plan.tag}`);
    return;
  }
  const release = await ensureGiteeRelease(plan, token);
  for (const asset of plan.assets) {
    uploadGiteeAsset({
      apiBase: plan.giteeApiBase,
      owner: plan.giteeOwner,
      repo: plan.giteeRepo,
      releaseId: release.id,
      token,
      filePath: asset.localPath,
    });
  }
}

async function ensureGiteeRelease(plan, token) {
  const existing = await findGiteeRelease(plan, token);
  if (existing) {
    console.log(`[mirror-llamacpp-runtime] Reusing Gitee release ${plan.tag} (${existing.id})`);
    return existing;
  }

  const url = `${plan.giteeApiBase}/repos/${encodeURIComponent(plan.giteeOwner)}/${encodeURIComponent(plan.giteeRepo)}/releases`;
  const body = new URLSearchParams({
    access_token: token,
    tag_name: plan.tag,
    name: plan.tag,
    target_commitish: plan.giteeTargetCommitish,
    body: `Mirrored llama.cpp runtime assets for ${plan.tag}.`,
  });
  const response = await fetchWithRetry(url, { method: 'POST', body });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to create Gitee release: HTTP ${response.status}${text ? ` ${text}` : ''}`);
  }
  const release = await response.json();
  console.log(`[mirror-llamacpp-runtime] Created Gitee release ${plan.tag} (${release.id})`);
  return release;
}

async function findGiteeRelease(plan, token) {
  const url = `${plan.giteeApiBase}/repos/${encodeURIComponent(plan.giteeOwner)}/${encodeURIComponent(plan.giteeRepo)}/releases?access_token=${encodeURIComponent(token)}&per_page=100`;
  const response = await fetchWithRetry(url);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to list Gitee releases: HTTP ${response.status}${text ? ` ${text}` : ''}`);
  }
  const releases = await response.json();
  if (!Array.isArray(releases)) return null;
  return releases.find(release => release?.tag_name === plan.tag || release?.tagName === plan.tag) ?? null;
}

async function fetchWithRetry(url, init, retries = DEFAULT_API_RETRY_COUNT) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok || attempt === retries || !isRetryableHttpStatus(response.status)) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
    }
    await sleep(DEFAULT_API_RETRY_DELAY_MS);
  }
  throw lastError ?? new Error('fetch failed');
}

function isRetryableHttpStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function uploadGiteeAsset(input) {
  if (!fs.existsSync(input.filePath)) {
    throw new Error(`Local file not found: ${input.filePath}`);
  }
  const url = `${input.apiBase}/repos/${encodeURIComponent(input.owner)}/${encodeURIComponent(input.repo)}/releases/${encodeURIComponent(String(input.releaseId))}/attach_files`;
  const result = spawnSync('curl', [
    '-f',
    '-sS',
    '--retry',
    '5',
    '--retry-delay',
    '5',
    '--retry-all-errors',
    '--connect-timeout',
    '30',
    '--max-time',
    '3600',
    '-X',
    'POST',
    '-F',
    `access_token=${input.token}`,
    '-F',
    `owner=${input.owner}`,
    '-F',
    `repo=${input.repo}`,
    '-F',
    `release_id=${input.releaseId}`,
    '-F',
    `file=@${path.resolve(input.filePath)}`,
    url,
  ], {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`Failed to upload ${path.basename(input.filePath)} to Gitee release.`);
  }
  console.log(`[mirror-llamacpp-runtime] Uploaded ${path.basename(input.filePath)}`);
}

async function main() {
  const rootDir = path.resolve(__dirname, '..');
  const options = parseArgs(process.argv.slice(2));
  const plan = buildMirrorPlan(rootDir, options);

  console.log(`[mirror-llamacpp-runtime] Tag: ${plan.tag}`);
  console.log(`[mirror-llamacpp-runtime] Upstream: ${plan.githubRepo}`);
  console.log(`[mirror-llamacpp-runtime] Output: ${plan.outputDir}`);
  console.log(`[mirror-llamacpp-runtime] Targets: ${Array.from(new Set(plan.assets.map(asset => asset.targetId))).join(', ')}`);

  for (const asset of plan.assets) {
    await downloadAsset(asset, options);
  }
  writeManifest(plan, options);
  await uploadAssets(plan, options);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[mirror-llamacpp-runtime] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}

module.exports = {
  buildMirrorPlan,
  parseArgs,
  resolveTargets,
};
