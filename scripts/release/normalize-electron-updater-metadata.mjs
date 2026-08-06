import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'js-yaml';

const [releaseVersion, platform, arch, variant, inputPath, outputPath] = process.argv.slice(2);
if (!releaseVersion || !platform || !arch || !variant || !inputPath || !outputPath) {
  throw new Error(
    'usage: normalize-electron-updater-metadata.mjs <version> <platform> <arch> <variant> <input.yml> <output.yml>',
  );
}
if (!/^[0-9A-Za-z][0-9A-Za-z.+-]*$/.test(releaseVersion)) {
  throw new Error(`Invalid release version: ${releaseVersion}`);
}

const expectedExtension =
  platform === 'win32'
    ? '.exe'
    : platform === 'darwin'
      ? '.zip'
      : platform === 'linux' && variant === 'appimage'
        ? '.appimage'
        : platform === 'linux' && variant === 'deb'
          ? '.deb'
          : null;
if (!expectedExtension) throw new Error(`Unsupported electron-updater target: ${platform}:${arch}:${variant}`);

function artifactFilename(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 240 ||
    value === '.' ||
    value === '..' ||
    /[\\/\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`electron-builder metadata contains an unsafe artifact name: ${value}`);
  }
  return value;
}

const source = yaml.load(await fs.readFile(inputPath, 'utf8'));
if (!source || typeof source !== 'object' || Array.isArray(source)) {
  throw new Error('electron-builder metadata must be a YAML object');
}
if (source.version !== releaseVersion || !Array.isArray(source.files)) {
  throw new Error('electron-builder metadata version or files are invalid');
}

const selected = source.files.find(file => {
  if (!file || typeof file !== 'object') return false;
  const filename = artifactFilename(file.url);
  return filename.toLowerCase().endsWith(expectedExtension);
});
if (
  !selected ||
  typeof selected.sha512 !== 'string' ||
  !/^[A-Za-z0-9+/]{86}(?:==)?$/.test(selected.sha512)
) {
  throw new Error(`electron-builder metadata has no ${expectedExtension} updater file`);
}

const filename = artifactFilename(selected.url);
const url = `https://updates.rongxzyai.com/v2/electron/releases/${encodeURIComponent(releaseVersion)}/${platform}/${arch}/${variant}/${encodeURIComponent(filename)}`;
const normalized = {
  ...source,
  files: [{ ...selected, url }],
  path: url,
  sha512: selected.sha512,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, yaml.dump(normalized, { lineWidth: -1, noRefs: true }));
