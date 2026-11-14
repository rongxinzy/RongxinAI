import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, 'resources/llamacpp-backends/manifest.json'), 'utf8'),
);
const bundle = JSON.parse(
  fs.readFileSync(path.join(root, 'resources/llamacpp-backends/bundle-checksums.json'), 'utf8'),
);

const tag = packageJson?.llamacpp?.runtimeReleaseTag?.trim();
const semantic = packageJson?.llamacpp?.runtimeSemanticVersion?.trim();

const errors = [];
if (!tag) errors.push('package.json llamacpp.runtimeReleaseTag is missing');
if (manifest.defaultVersion !== tag) {
  errors.push(`manifest.defaultVersion (${manifest.defaultVersion}) !== package tag (${tag})`);
}
if (bundle.version !== tag) {
  errors.push(`bundle-checksums.version (${bundle.version}) !== package tag (${tag})`);
}
if (semantic && manifest.runtimeSemanticVersion && manifest.runtimeSemanticVersion !== semantic) {
  errors.push('manifest.runtimeSemanticVersion !== package.json');
}
if (semantic && bundle.runtimeSemanticVersion && bundle.runtimeSemanticVersion !== semantic) {
  errors.push('bundle-checksums.runtimeSemanticVersion !== package.json');
}

if (errors.length > 0) {
  console.error(
    '[llamacpp-pin] consistency check failed:\n' + errors.map(e => `  - ${e}`).join('\n'),
  );
  process.exit(1);
}

console.log(`[llamacpp-pin] ok (${semantic ?? 'no-semver'} / ${tag})`);
