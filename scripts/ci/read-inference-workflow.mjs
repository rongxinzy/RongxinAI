import { readFileSync } from 'node:fs';
import path from 'node:path';

// Contract tests inspect the steps actually connected by the workflow, not a
// disconnected copy of the action source. This intentionally supports only our
// two local composites and their simple expression-only input bindings.
export function readInferenceWorkflow(root = process.cwd()) {
  let workflow = readFileSync(
    path.join(root, '.github/workflows/build-inference-editions.yml'),
    'utf8',
  );
  for (const action of ['build-inference-packages', 'assemble-inference-candidate']) {
    const blocks = workflow.split(/(?=^      - )/m);
    const calls = blocks.filter(block => block.includes(`uses: ./.github/actions/${action}\n`));
    if (calls.length !== 1) throw new Error(`Expected one connected ${action} action`);
    const call = calls[0];
    const condition = call.match(/^        if: (.+)$/m)?.[1];
    const expected =
      action === 'assemble-inference-candidate' ? "${{ inputs.mode == 'release' }}" : undefined;
    if (condition !== expected) throw new Error(`Unexpected ${action} call condition`);
    const bindings = new Map(
      [...call.matchAll(/^          ([\w-]+): \$\{\{ (.+) \}\}$/gm)].map(match => [
        match[1],
        match[2],
      ]),
    );
    const source = readFileSync(path.join(root, '.github/actions', action, 'action.yml'), 'utf8');
    const header = source.slice(source.indexOf('inputs:\n'), source.indexOf('runs:\n'));
    const inputs = header.split('outputs:\n')[0];
    const declared = [...inputs.matchAll(/^  ([\w-]+):$/gm)].map(match => match[1]);
    if (declared.length !== bindings.size || declared.some(key => !bindings.has(key))) {
      throw new Error(`Incomplete ${action} input bindings`);
    }
    const marker = 'runs:\n  using: composite\n  steps:\n';
    if (!source.includes(marker)) throw new Error(`Invalid ${action} composite`);
    let body = source.split(marker)[1];
    body = body.replace(/\binputs\.([\w-]+)/g, (_, key) => {
      if (!bindings.has(key)) throw new Error(`Unbound ${action} input ${key}`);
      return bindings.get(key);
    });
    body = body.replace(
      /^      shell: \$\{\{ matrix\.platform == 'windows' && 'pwsh' \|\| 'bash -e \{0\}' \}\}\n/gm,
      '',
    );
    body = body
      .split('\n')
      .map(line => (line ? `  ${line}` : line))
      .join('\n');
    workflow = workflow.replace(call, body);
    const outputPattern = /^  ([\w-]+):\n    description: .+\n    value: \$\{\{ (.+) \}\}$/gm;
    for (const match of header.matchAll(outputPattern)) {
      workflow = workflow.replaceAll(`steps.${action}.outputs.${match[1]}`, match[2]);
    }
  }
  return workflow;
}
