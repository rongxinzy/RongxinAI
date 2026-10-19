'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

// The official macOS and Linux llama.cpp archives ship versioned shared
// libraries behind relative symlinks (libllama.dylib -> libllama.0.dylib).
// fs.cpSync rewrites those to absolute paths into vendor/ by default, which
// leaves links pointing outside the app bundle: codesign rejects the macOS
// .app and the installed Linux package would carry dangling links.
function copyRuntimeTree(sourceRoot, targetRoot) {
  fs.rmSync(targetRoot, { recursive: true, force: true });
  fs.cpSync(sourceRoot, targetRoot, { recursive: true, verbatimSymlinks: true });
}

function main() {
  const edition = (process.env.ZHIYUAN_UPDATE_VARIANT || 'cpu').trim().toLowerCase();
  if (edition === 'lite') {
    console.log('[prepare-inference-edition-runtime] lite edition skips bundled llama.cpp.');
    return;
  }

  const sourceRoot = path.join(ROOT, 'vendor', 'llamacpp', edition);
  const targetRoot = path.join(ROOT, 'resources', 'llamacpp-bundled');
  const manifestPath = path.join(sourceRoot, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    console.warn(
      `[prepare-inference-edition-runtime] Missing ${manifestPath}; skip staging bundled runtime.`,
    );
    return;
  }

  copyRuntimeTree(sourceRoot, targetRoot);

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const executablePath = path.join(targetRoot, manifest.executable);
  if (!fs.existsSync(executablePath)) {
    throw new Error(`Bundled runtime executable missing: ${manifest.executable}`);
  }
  manifest.sha256 = sha256File(executablePath);
  if (manifest.vulkanExecutable) {
    const vulkanPath = path.join(targetRoot, manifest.vulkanExecutable);
    if (fs.existsSync(vulkanPath)) {
      manifest.vulkanSha256 = sha256File(vulkanPath);
    }
  }
  if (manifest.cpuFallbackExecutable) {
    const fallbackPath = path.join(targetRoot, manifest.cpuFallbackExecutable);
    if (fs.existsSync(fallbackPath)) {
      manifest.cpuFallbackSha256 = sha256File(fallbackPath);
    }
  }
  fs.writeFileSync(
    path.join(targetRoot, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  console.log(
    `[prepare-inference-edition-runtime] Staged ${edition} runtime to resources/llamacpp-bundled (${manifest.sha256.slice(0, 12)}…).`,
  );
}

if (require.main === module) {
  main();
}

module.exports = { copyRuntimeTree };
