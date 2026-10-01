import { expect, test, vi } from 'vitest';
import { CoworkRunPolicy } from '../shared/cowork/runState';
import { CoworkContentBuffer } from '../renderer/services/coworkContentBuffer';
import { TextWorkerKind, runTextWorkerOperation } from './workbenchTask/textWorkerOperations';
import { CoworkContentProjection } from './coworkContentProjection';

test('keeps growing past the old IPC cap with bounded frames and exact final metadata', async () => {
  const projection = new CoworkContentProjection(async input => runTextWorkerOperation(input));
  const gap = vi.fn();
  const buffer = new CoworkContentBuffer(gap);
  for (const length of [100, 125_000, 190_000]) {
    const content = 'a'.repeat(length - 4) + 'END!';
    const patches = await projection.project('session', 'message', content, {
      isFinal: length === 190_000,
    });
    expect(
      patches.every(patch => patch.content.length <= CoworkRunPolicy.ContentChunkCharacters),
    ).toBe(true);
    let update;
    for (const patch of patches) update = buffer.apply(patch) ?? update;
    expect(update?.content).toBe(content);
    expect(update?.metadata?.isFinal).toBe(length === 190_000);
  }
  expect(gap).not.toHaveBeenCalled();
});
test('sends only appended text and replays a full snapshot to a newly attached consumer', async () => {
  const projection = new CoworkContentProjection(async input => runTextWorkerOperation(input));
  await projection.project('a', 'm', 'hello');
  expect((await projection.project('a', 'm', 'hello world'))[0]).toMatchObject({
    offset: 5,
    content: ' world',
  });
  const buffer = new CoworkContentBuffer(vi.fn());
  const replay = await projection.replay('a');
  expect(replay[0].offset).toBe(0);
  expect(buffer.apply(replay[0])?.content).toBe('hello world');
});
test('detects dropped frames and rejects duplicates and stale revisions', async () => {
  const projection = new CoworkContentProjection(async input => runTextWorkerOperation(input));
  const gap = vi.fn();
  const buffer = new CoworkContentBuffer(gap);
  const patches = await projection.project('a', 'm', 'x'.repeat(150_000));
  buffer.apply(patches[0]);
  expect(buffer.apply(patches[2])).toBeNull();
  expect(gap).toHaveBeenCalledWith('a');
  const replay = await projection.replay('a');
  for (const patch of replay) buffer.apply(patch);
  expect(buffer.apply(patches[0])).toBeNull();
  expect(buffer.apply(replay.at(-1)!)).toBeNull();
});

test('a lost rewrite frame cannot reuse the previous text prefix even when its length matches', async () => {
  const projection = new CoworkContentProjection(async input => runTextWorkerOperation(input));
  const gap = vi.fn();
  const buffer = new CoworkContentBuffer(gap);
  for (const frame of await projection.project('a', 'm', 'old'.repeat(20_000))) buffer.apply(frame);
  const rewritten = await projection.project('a', 'm', 'new'.repeat(50_000));
  for (const frame of rewritten.slice(1)) expect(buffer.apply(frame)).toBeNull();
  expect(gap).toHaveBeenCalledWith('a');
  let update;
  for (const frame of await projection.replay('a')) update = buffer.apply(frame) ?? update;
  expect(update?.content).toBe('new'.repeat(50_000));
});

test('replay uses the latest content when streaming continues while another message is replayed', async () => {
  let release: (() => void) | undefined;
  const projection = new CoworkContentProjection(async input => {
    if (input.kind === TextWorkerKind.Content && input.reset && input.content === 'first') {
      await new Promise<void>(resolve => {
        release = resolve;
      });
    }
    return runTextWorkerOperation(input);
  });
  await projection.project('a', 'first', 'first');
  await projection.project('a', 'second', 'old');
  const replay = projection.replay('a');
  await vi.waitFor(() => expect(release).toBeDefined());
  await projection.project('a', 'second', 'new live content');
  release!();
  const frames = await replay;
  expect(
    frames
      .filter(frame => frame.messageId === 'second')
      .map(frame => frame.content)
      .join(''),
  ).toBe('new live content');
});
