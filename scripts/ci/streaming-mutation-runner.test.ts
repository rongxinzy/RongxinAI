import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { expect, test } from 'vitest';

test.each([
  [1, [{ status: 'failed' }], 0, 'caught'],
  [0, [{ status: 'passed' }], 0, 'survived'],
  [1, [], 0, 'error'],
  [1, [{ status: 'failed' }], 1, 'error'],
  [-9, [{ status: 'failed' }], 0, 'error'],
])(
  'mutation classification requires an assertion failure (%s)',
  (exit, assertions, crashes, expected) => {
    const modulePath = path.join(__dirname, 'run-streaming-mutations.py');
    const report = JSON.stringify({
      numRuntimeErrorTestSuites: crashes,
      testResults: [{ assertionResults: assertions }],
    });
    const result = spawnSync(
      'python3',
      [
        '-c',
        'import importlib.util,json,sys; s=importlib.util.spec_from_file_location("mutations",sys.argv[1]); m=importlib.util.module_from_spec(s); s.loader.exec_module(m); print(m.classify_result(int(sys.argv[2]),json.loads(sys.argv[3])))',
        modulePath,
        String(exit),
        report,
      ],
      { encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(expected);
  },
);
