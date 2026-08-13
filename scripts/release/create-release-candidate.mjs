import { createCandidateManifest } from './release-candidate-manifest.mjs';

const [releaseVersion, sourceCommit, candidateRunId, outputDirectory, manifestName, ...specs] =
  process.argv.slice(2);
if (!releaseVersion || !sourceCommit || !candidateRunId || !outputDirectory || !manifestName || specs.length === 0) {
  throw new Error(
    'usage: create-release-candidate.mjs <version> <commit> <run-id> <output-directory> <manifest-name> <file:platform:arch:variant:kind>...',
  );
}

await createCandidateManifest({
  releaseVersion,
  sourceCommit,
  candidateRunId,
  outputDirectory,
  manifestName,
  specs,
});
