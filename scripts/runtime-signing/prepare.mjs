import { appendFileSync, writeFileSync } from 'node:fs';
import { readBuildRun, sourceFor } from './provenance.mjs';

const matrix = [];
for (const [key, value] of [['sidecar', process.env.SIDECAR_RUN_ID], ['engram', process.env.ENGRAM_RUN_ID]]) {
  if (!value) continue;
  const build = await readBuildRun(key, value);
  matrix.push({ ...build, artifact: sourceFor(key).artifact });
}
if (!matrix.length) throw new Error('Select at least one successful runtime build.');
writeFileSync('runtime-signing-plan.json', JSON.stringify(matrix, null, 2));
appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify({ include: matrix })}\n`);
