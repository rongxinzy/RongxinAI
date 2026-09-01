import { expect, test } from 'vitest';

import { MODEL_AUTO_ROTATE_SPEED, ModelFileExtension } from './constants';
import { bindModelAutoRotation, parseModelObject } from './ModelRenderer';

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a;

function createGlb(json: object): ArrayBuffer {
  const encodedJson = new TextEncoder().encode(JSON.stringify(json));
  const paddedJsonLength = Math.ceil(encodedJson.byteLength / 4) * 4;
  const buffer = new ArrayBuffer(20 + paddedJsonLength);
  const view = new DataView(buffer);

  view.setUint32(0, GLB_MAGIC, true);
  view.setUint32(4, GLB_VERSION, true);
  view.setUint32(8, buffer.byteLength, true);
  view.setUint32(12, paddedJsonLength, true);
  view.setUint32(16, GLB_JSON_CHUNK_TYPE, true);

  const jsonChunk = new Uint8Array(buffer, 20, paddedJsonLength);
  jsonChunk.fill(0x20);
  jsonChunk.set(encodedJson);
  return buffer;
}

class FakeAutoRotationControls {
  autoRotate = false;
  autoRotateSpeed = 0;
  private readonly startListeners = new Set<() => void>();

  addEventListener(type: 'start', listener: () => void): void {
    if (type === 'start') this.startListeners.add(listener);
  }

  removeEventListener(type: 'start', listener: () => void): void {
    if (type === 'start') this.startListeners.delete(listener);
  }

  startInteraction(): void {
    this.startListeners.forEach(listener => listener());
  }
}

test('waits for a GLB scene to finish parsing', async () => {
  const buffer = createGlb({
    asset: { version: '2.0' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'PreviewRoot' }],
  });

  const object = await parseModelObject(ModelFileExtension.Glb, buffer);

  expect(object.children).toHaveLength(1);
  expect(object.children[0]?.name).toBe('PreviewRoot');
});

test('propagates GLB parsing errors', async () => {
  await expect(parseModelObject(ModelFileExtension.Glb, new ArrayBuffer(0))).rejects.toThrow();
});

test('toggles clockwise model auto-rotation', () => {
  const controls = new FakeAutoRotationControls();
  const changes: boolean[] = [];
  const binding = bindModelAutoRotation(controls, rotating => changes.push(rotating));

  expect(controls.autoRotateSpeed).toBe(MODEL_AUTO_ROTATE_SPEED);
  expect(controls.autoRotateSpeed).toBeLessThan(0);
  expect(binding.toggle()).toBe(true);
  expect(controls.autoRotate).toBe(true);
  expect(binding.toggle()).toBe(false);
  expect(controls.autoRotate).toBe(false);
  expect(changes).toEqual([true, false]);
});

test('stops auto-rotation on interaction and removes the listener on cleanup', () => {
  const controls = new FakeAutoRotationControls();
  const changes: boolean[] = [];
  const binding = bindModelAutoRotation(controls, rotating => changes.push(rotating));

  binding.toggle();
  controls.startInteraction();
  expect(controls.autoRotate).toBe(false);
  expect(changes).toEqual([true, false]);

  binding.toggle();
  binding.dispose();
  controls.startInteraction();
  expect(controls.autoRotate).toBe(true);
  expect(changes).toEqual([true, false, true]);
});
