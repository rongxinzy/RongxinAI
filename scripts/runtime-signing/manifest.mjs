import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  executableHash,
  runId,
  signerThumbprint,
  SigningAuthority,
  sourceFor,
} from './provenance.mjs';

const [phase, directory] = process.argv.slice(2);
const key = process.env.RUNTIME_KEY;
const source = sourceFor(key);
const manifestPath = path.join(directory, 'signed-runtime-manifest.json');
if (phase === 'before') {
  const executables = readdirSync(directory)
    .filter(name => /\.exe$/i.test(name))
    .sort();
  if (JSON.stringify(executables) !== JSON.stringify([...source.files].sort())) {
    throw new Error('Input artifact contains an unexpected executable set.');
  }
  const manifest = {
    schemaVersion: 1,
    key,
    sourceRepository: source.repo,
    sourceRunId: runId(process.env.SOURCE_RUN_ID),
    sourceSha: process.env.SOURCE_SHA,
    sourceTag: process.env.SOURCE_TAG,
    signingRepository: SigningAuthority.repo,
    signingRunId: runId(process.env.GITHUB_RUN_ID),
    signerThumbprint: signerThumbprint(process.env.CERTUM_CERT_THUMBPRINT),
    files: source.files.map(name => ({ name, unsignedSha256: executableHash(directory, name) })),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
} else if (phase === 'after') {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.files = manifest.files.map(file => ({
    ...file,
    signedSha256: executableHash(directory, file.name),
  }));
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
} else {
  throw new Error('Invalid signing manifest phase.');
}
