import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { readInferenceWorkflow } from '../scripts/ci/read-inference-workflow.mjs';

const root = path.resolve(__dirname, '..');
const workflowPath = '.github/workflows/build-inference-editions.yml';

test('inference workflow expands connected actions before applying release contracts', () => {
  const expanded = readInferenceWorkflow(root);
  const accept = expanded.indexOf('name: Accept final Linux release packages');
  const assemble = expanded.indexOf('name: Assemble Linux release payload');
  const verify = expanded.indexOf('node scripts/ci/linux-release-acceptance.mjs verify');
  const candidate = expanded.indexOf('node scripts/release/create-release-candidate.mjs', assemble);
  assert.ok(accept > 0 && assemble > accept && verify > assemble && candidate > verify);
  assert.match(expanded, /linux-release-acceptance-.*github.run_attempt/);
  assert.match(expanded, /libfuse2t64/);
  assert.match(expanded, /steps.certum-signing.outputs.thumbprint/);
  assert.match(expanded, /steps.llama-runtime.outputs.cache-primary-key/);
  assert.doesNotMatch(
    expanded,
    /uses: \.\/\.github\/actions\/(?:build-inference-packages|assemble-inference-candidate)/,
  );
});

test('workflow contract reader rejects missing bindings and changed call conditions', () => {
  const temporary = mkdtempSync(path.join(tmpdir(), 'inference-workflow-'));
  try {
    cpSync(path.join(root, '.github'), path.join(temporary, '.github'), { recursive: true });
    const filename = path.join(temporary, workflowPath);
    const original = readFileSync(filename, 'utf8');
    writeFileSync(filename, original.replace('          platform: ${{ matrix.platform }}\n', ''));
    assert.throws(() => readInferenceWorkflow(temporary), /input bindings/);
    writeFileSync(
      filename,
      original.replace(
        "        if: ${{ inputs.mode == 'release' }}\n        uses: ./.github/actions/assemble-inference-candidate",
        '        uses: ./.github/actions/assemble-inference-candidate',
      ),
    );
    assert.throws(() => readInferenceWorkflow(temporary), /call condition/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
