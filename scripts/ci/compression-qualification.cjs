const fs = require('node:fs');
const crypto = require('node:crypto');
const { sha256File } = require('../windows-resource-pack.cjs');
const { createSkillPythonProbe } = require('./skill-python-probe.cjs');

const directory = 'build-tar/windows-components';
const reportPath = `${directory}/skill-python-compression-benchmark.json`;
const manifest = JSON.parse(fs.readFileSync(`${directory}/manifest.json`, 'utf8'));
const component = manifest.components.find(item => item.key === 'skill-python');
if (!component || component.archive !== 'skill-python.7z')
  throw new Error('Missing Skill Python component');
const archiveHash = sha256File(`${directory}/${component.archive}`);
if (archiveHash !== component.archiveSha256)
  throw new Error('Skill Python archive digest mismatch');
const fingerprint = crypto
  .createHash('sha256')
  .update(
    JSON.stringify([
      component.contentId,
      component.archiveCompression,
      archiveHash,
      sha256File('node_modules/7zip-bin/win/x64/7za.exe'),
      sha256File('scripts/ci/benchmark-skill-python-compression.ps1'),
      sha256File('scripts/ci/skill-python-probe.cjs'),
      sha256File('scripts/setup-skill-python-runtime.js'),
      createSkillPythonProbe(process.cwd()),
      sha256File(__filename),
    ]),
  )
  .digest('hex');

const action = process.argv[2];
if (action === 'key') {
  if (!process.env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is required');
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `key=compression-v1-${fingerprint}\n`);
} else {
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  if (
    report.qualified !== true ||
    report.contentSha256Equal !== true ||
    report.pythonProbePassed !== true ||
    report.solidBytes !== fs.statSync(`${directory}/${component.archive}`).size ||
    !Number.isFinite(report.savedBytes) ||
    report.savedBytes < 1024 * 1024 ||
    !Number.isFinite(report.extractionRatio) ||
    report.extractionRatio > 1.25
  ) {
    throw new Error('Compression qualification did not pass required measurements');
  }
  if (action === 'seal') {
    fs.writeFileSync(reportPath, JSON.stringify({ ...report, fingerprint }, null, 2));
  } else if (action !== 'verify' || report.fingerprint !== fingerprint) {
    throw new Error('Compression qualification fingerprint mismatch');
  }
  console.log(
    '[Compression] Verified content, archive, tool and policy qualification ' + fingerprint,
  );
}
