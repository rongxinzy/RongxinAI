import { expect, test, vi } from 'vitest';
import { CoworkRunPolicy } from '../shared/cowork/runState';
import { CoworkContentBuffer } from '../renderer/services/coworkContentBuffer';
import { CoworkContentProjection } from './coworkContentProjection';

test('keeps growing past the old IPC cap with bounded frames and exact final metadata', async () => {
  const projection = new CoworkContentProjection();
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

test('detects dropped frames and rejects duplicates and stale revisions', async () => {
  const projection = new CoworkContentProjection();
  const gap = vi.fn();
  const buffer = new CoworkContentBuffer(gap);
  const patches = await projection.project('a', 'm', 'x'.repeat(150_000));
  buffer.apply(patches[0]);
  expect(buffer.apply(patches[2])).toBeNull();
  expect(gap).toHaveBeenCalledWith('a');
  // A fresh projection of the same message carries a new revision; a consumer
  // that already applied the old frames rejects it as stale.
  const reprojected = await projection.project('a', 'm', 'x'.repeat(150_000));
  expect(buffer.apply(reprojected[0])).toBeNull();
});

test('a rewrite emits a fresh offset-zero snapshot', async () => {
  const projection = new CoworkContentProjection();
  const gap = vi.fn();
  const buffer = new CoworkContentBuffer(gap);
  for (const frame of await projection.project('a', 'm', 'old'.repeat(20_000))) buffer.apply(frame);
  const rewritten = await projection.project('a', 'm', 'new'.repeat(50_000));
  expect(rewritten[0]?.offset).toBe(0);
  let update;
  for (const frame of rewritten) update = buffer.apply(frame) ?? update;
  expect(update?.content).toBe('new'.repeat(50_000));
});

test('a fresh consumer accepts a full frame set on a new revision', async () => {
  const projection = new CoworkContentProjection();
  await projection.project('a', 'm', 'first');
  const frames = await projection.project('a', 'm', 'hello world');
  const buffer = new CoworkContentBuffer(vi.fn());
  let update;
  for (const frame of frames) update = buffer.apply(frame) ?? update;
  expect(update?.content).toBe('hello world');
});
