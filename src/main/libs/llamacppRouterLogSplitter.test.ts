import fs from 'fs';
import os from 'os';
import path from 'path';
import { expect, test } from 'vitest';

import {
  DEFAULT_LLAMACPP_ROUTER_LOG_TAIL_LINES,
  LlamaCppRouterLogSplitter,
  type LlamaCppRouterModelLogWriter,
} from './llamacppRouterLogSplitter';

// Excerpts from a real llama-server b9244 router session
// (/workspace/router-lab/router.log). The router forwards every child line as
// "[<port padded to 5>] <line>" and announces spawns with
// "spawning server instance with name=<NAME> on port <PORT>".
const SMOl_SPAWN_LINES = [
  '0.18.371.713 I srv          load: spawning server instance with name=smol on port 49651',
  '0.18.371.745 I srv          load: spawning server instance with args:',
  '0.18.371.745 I srv          load:   /workspace/router-lab/llama-b9244/llama-server',
  '0.18.371.746 I srv          load:   --host',
  '0.18.371.746 I srv          load:   127.0.0.1',
  '0.18.371.746 I srv          load:   --port',
  '0.18.371.746 I srv          load:   49651',
  '0.18.371.748 I srv          load:   --tensor-split',
  '0.18.371.754 I srv          load:   3,1',
];

const SMOl_CHILD_LINES = [
  '[49651] 0.00.008.719 I log_info: verbosity = 3 (adjust with the `-lv N` CLI arg)',
  "[49651] 0.00.010.131 I srv    load_model: loading model '/workspace/router-lab/models/SmolLM2-135M-Instruct-Q4_K_M.gguf'",
  '[49651] 0.00.403.365 I srv          main: server is listening on http://127.0.0.1:49651',
  '[49651] cmd_child_to_router:ready',
];

const QWEN_SPAWN_LINES = [
  '0.18.959.546 I srv          load: spawning server instance with name=qwen on port 52827',
  '0.18.959.577 I srv          load: spawning server instance with args:',
  '0.18.959.580 I srv          load:   /workspace/router-lab/llama-b9244/llama-server',
  '0.18.959.580 I srv          load:   --ctx-size',
  '0.18.959.580 I srv          load:   1024',
];

const QWEN_CHILD_LINES = [
  '[52827] 0.00.008.112 I log_info: verbosity = 3 (adjust with the `-lv N` CLI arg)',
  '[52827] 0.00.975.198 I srv          main: model loaded',
  '[52827] cmd_child_to_router:ready',
];

const CORRUPT_SPAWN_LINES = [
  '0.43.390.191 I srv          load: spawning server instance with name=corrupt on port 35021',
  '0.43.390.226 I srv          load: spawning server instance with args:',
  '0.43.390.231 I srv          load:   /workspace/router-lab/mdir/corrupt-trunc.gguf',
];

const CORRUPT_CHILD_LINES = [
  "[35021] 0.00.009.409 I srv    load_model: loading model '/workspace/router-lab/mdir/corrupt-trunc.gguf'",
  "[35021] 0.00.021.371 E llama_model_load: error loading model: tensor 'token_embd.weight' data is not within the file bounds, model is corrupted or incomplete",
  "[35021] 0.00.030.948 E common_init_from_params: failed to load model '/workspace/router-lab/mdir/corrupt-trunc.gguf'",
  '[35021] 0.00.031.340 E srv          main: exiting due to model loading error',
];

const BADARGS_SPAWN_LINES = [
  '0.50.055.895 I srv          load: spawning server instance with name=badargs on port 35515',
  '0.50.055.922 I srv          load: spawning server instance with args:',
  '0.50.055.926 I srv          load:   --cache-type-k',
  '0.50.055.926 I srv          load:   nonsense',
];

const BADARGS_CHILD_LINES = [
  '[35515] error while handling argument "--cache-type-k": Unsupported cache type: nonsense',
  '[35515] ',
  '[35515] usage:',
];

/** Router lines that carry no port prefix and no spawn context. */
const ROUTER_LEVEL_LINES = [
  '0.18.371.637 I srv  ensure_model: model name=smol is not loaded, loading...',
  '0.18.372.312 I srv  ensure_model: waiting until model name=smol is fully loaded...',
  '0.43.312.807 I srv    unload_lru: models_max limit reached, removing LRU name=qwen',
];

type RecordedWriter = LlamaCppRouterModelLogWriter & { lines: string[] };

function createRecordingSplitter(input?: {
  tailLines?: number;
  onUnattributedLine?: (line: string) => void;
}): { splitter: LlamaCppRouterLogSplitter; writersByModel: Map<string, RecordedWriter> } {
  const writersByModel = new Map<string, RecordedWriter>();
  const splitter = new LlamaCppRouterLogSplitter({
    userDataPath: '/tmp/llamacpp-router-log-splitter-test',
    ...(input?.tailLines !== undefined ? { tailLines: input.tailLines } : {}),
    ...(input?.onUnattributedLine ? { onUnattributedLine: input.onUnattributedLine } : {}),
    createWriter: ({ modelName }) => {
      const existing = writersByModel.get(modelName);
      if (existing) return existing;
      const writer: RecordedWriter = {
        filePath: path.join('/tmp/logs', modelName, `${modelName}-launch.txt`),
        lines: [],
        append: async text => {
          writer.lines.push(text);
        },
      };
      writersByModel.set(modelName, writer);
      return writer;
    },
  });
  return { splitter, writersByModel };
}

test('attributes spawn, args block, and child lines to one model log', async () => {
  const { splitter, writersByModel } = createRecordingSplitter();

  splitter.appendChunk([...SMOl_SPAWN_LINES, ...SMOl_CHILD_LINES].join('\n') + '\n');
  await splitter.idle();

  const writer = writersByModel.get('smol');
  expect(writer).toBeDefined();
  // Spawn line and args block keep their router form; child lines lose "[port] ".
  expect(writer!.lines.join('')).toEqual(
    [...SMOl_SPAWN_LINES, ...SMOl_CHILD_LINES.map(stripPortPrefix)]
      .map(line => `${line}\n`)
      .join(''),
  );
});

test('keeps per-model logs separate and never writes an unknown port to a model log', async () => {
  const unattributed: string[] = [];
  const { splitter, writersByModel } = createRecordingSplitter({
    onUnattributedLine: line => unattributed.push(line),
  });

  const unknownPortLine = '[61000] 0.00.001.000 I log_info: orphaned child output';
  splitter.appendChunk(
    [...SMOl_SPAWN_LINES, ...SMOl_CHILD_LINES, unknownPortLine, ...ROUTER_LEVEL_LINES].join('\n') +
      '\n',
  );
  await splitter.idle();

  expect(writersByModel.get('smol')!.lines.join('')).not.toContain('orphaned child output');
  expect(writersByModel.get('smol')!.lines.join('')).not.toContain('ensure_model');
  expect(unattributed).toContain(unknownPortLine);
  for (const line of ROUTER_LEVEL_LINES) {
    expect(unattributed).toContain(line);
  }
});

test('a new spawn on a reused port replaces the previous port mapping', async () => {
  const { splitter, writersByModel } = createRecordingSplitter();

  // smol first takes port 49651, then qwen is spawned on the same port later.
  const qwenRespawn = QWEN_SPAWN_LINES.map(line =>
    line.replace('name=qwen on port 52827', 'name=qwen on port 49651'),
  );
  const qwenChildOnReusedPort = QWEN_CHILD_LINES.map(line => line.replaceAll('[52827]', '[49651]'));
  splitter.appendChunk(
    [...SMOl_SPAWN_LINES, ...SMOl_CHILD_LINES, ...qwenRespawn, ...qwenChildOnReusedPort].join(
      '\n',
    ) + '\n',
  );
  await splitter.idle();

  const smolLog = writersByModel.get('smol')!.lines.join('');
  const qwenLog = writersByModel.get('qwen')!.lines.join('');
  expect(smolLog).toContain(
    "load_model: loading model '/workspace/router-lab/models/SmolLM2-135M-Instruct-Q4_K_M.gguf'",
  );
  // Lines after the respawn land in qwen's log, not smol's.
  expect(qwenLog).toContain('srv          main: model loaded');
  expect(smolLog).not.toContain('srv          main: model loaded');
});

test('buffers partial lines across chunk boundaries split mid-line', async () => {
  const { splitter, writersByModel } = createRecordingSplitter();

  const fullText = [...SMOl_SPAWN_LINES, ...SMOl_CHILD_LINES].join('\n') + '\n';
  // 7-byte chunks guarantee splits inside lines, inside the "[port] " prefix,
  // and inside the spawn notice.
  for (let index = 0; index < fullText.length; index += 7) {
    splitter.appendChunk(fullText.slice(index, index + 7));
  }
  await splitter.idle();

  const writer = writersByModel.get('smol')!;
  expect(writer.lines).toEqual(
    [...SMOl_SPAWN_LINES, ...SMOl_CHILD_LINES.map(stripPortPrefix)].map(line => `${line}\n`),
  );
});

test('flush emits a trailing partial line so failure tails are not lost', async () => {
  const { splitter } = createRecordingSplitter();

  splitter.appendChunk(
    [...CORRUPT_SPAWN_LINES, ...CORRUPT_CHILD_LINES.slice(0, 3)].join('\n') + '\n',
  );
  splitter.appendChunk('[35021] 0.00.031.340 E srv          main: exiting due to model load');
  splitter.flush();
  await splitter.idle();

  const tail = splitter.getRecentLines('corrupt');
  expect(tail).toContain(
    "0.00.021.371 E llama_model_load: error loading model: tensor 'token_embd.weight' data is not within the file bounds, model is corrupted or incomplete",
  );
  expect(tail).toContain('0.00.031.340 E srv          main: exiting due to model load');
});

test('exposes the most recent spawn tail per model with the port prefix stripped', async () => {
  const { splitter } = createRecordingSplitter();

  splitter.appendChunk([...BADARGS_SPAWN_LINES, ...BADARGS_CHILD_LINES].join('\n') + '\n');
  await splitter.idle();

  const tail = splitter.getRecentLines('badargs');
  expect(tail).toEqual([
    ...BADARGS_SPAWN_LINES,
    'error while handling argument "--cache-type-k": Unsupported cache type: nonsense',
    '',
    'usage:',
  ]);
  expect(splitter.getRecentLines('never-spawned')).toEqual([]);
});

test('tail keeps only the configured number of most recent lines', async () => {
  const tailLines = 5;
  const { splitter } = createRecordingSplitter({ tailLines });

  const spawnLine =
    '0.02.028.925 I srv          load: spawning server instance with name=qwen on port 33623';
  const childLines = Array.from(
    { length: 12 },
    (_unused, index) => `[33623] 0.09.082.0${index} I srv  update_slots: all slots are idle`,
  );
  splitter.appendChunk([spawnLine, ...childLines].join('\n') + '\n');
  await splitter.idle();

  expect(splitter.getRecentLines('qwen')).toEqual(
    childLines.slice(-tailLines).map(stripPortPrefix),
  );
  expect(splitter.getRecentLines('qwen', 2)).toEqual(childLines.slice(-2).map(stripPortPrefix));
});

test('a model respawn keeps only the new spawn in the recent tail', async () => {
  const { splitter } = createRecordingSplitter();

  const qwenRespawn = QWEN_SPAWN_LINES.map(line => line.replace('on port 52827', 'on port 53789'));
  const qwenRespawnChildren = QWEN_CHILD_LINES.map(line => line.replaceAll('[52827]', '[53789]'));
  splitter.appendChunk([...QWEN_SPAWN_LINES, ...QWEN_CHILD_LINES].join('\n') + '\n');
  splitter.appendChunk([...qwenRespawn, ...qwenRespawnChildren].join('\n') + '\n');
  await splitter.idle();

  const tail = splitter.getRecentLines('qwen');
  expect(tail).toEqual([...qwenRespawn, ...qwenRespawnChildren.map(stripPortPrefix)]);
});

test('writes real log files into the model-launch directory', async () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'llamacpp-router-split-'));
  try {
    const splitter = new LlamaCppRouterLogSplitter({ userDataPath });
    splitter.appendChunk([...SMOl_SPAWN_LINES, ...SMOl_CHILD_LINES].join('\n') + '\n');
    await splitter.idle();

    const filePath = splitter.getCurrentLogFilePath('smol');
    expect(filePath).toBeDefined();
    expect(filePath).toContain(path.join('logs', 'llamacpp', 'model-launch'));
    expect(path.basename(filePath!)).toMatch(/^smol_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.txt$/);

    const written = fs.readFileSync(filePath!, 'utf-8');
    expect(written).toContain(SMOl_SPAWN_LINES[0]);
    expect(written).toContain('log_info: verbosity = 3');
    expect(written).not.toContain('[49651] ');
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test('failure tail feeds the load-error classifier with real corrupt-gguf output', async () => {
  const { splitter } = createRecordingSplitter();

  splitter.appendChunk([...CORRUPT_SPAWN_LINES, ...CORRUPT_CHILD_LINES].join('\n') + '\n');
  await splitter.idle();

  const failureText = splitter.getRecentLines('corrupt').join('\n');
  expect(failureText).toMatch(/model is corrupted or incomplete/);
  expect(failureText).toMatch(/failed to load model/);
  expect(failureText).toMatch(/exiting due to model loading error/);
});

test('default tail capacity is a named constant', () => {
  expect(DEFAULT_LLAMACPP_ROUTER_LOG_TAIL_LINES).toBeGreaterThan(0);
});

function stripPortPrefix(line: string): string {
  return line.replace(/^\[\s?\d{1,5}\]\s?/, '');
}
