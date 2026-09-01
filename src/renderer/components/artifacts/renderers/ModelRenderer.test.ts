import { expect, test } from 'vitest';

import { ModelFileExtension } from './constants';
import { parseModelObject } from './ModelRenderer';

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
