import { readFileSync } from 'fs';
import { expect, test } from 'vitest';

import {
  ArtifactPreviewMode,
  getArtifactPreviewMode,
  getArtifactTypeByExtension,
  isBinaryArtifactFile,
} from '../src/shared/cowork/artifactPreview';

test('routes CAD model extensions to the model artifact type', () => {
  for (const extension of ['.stl', '.obj', '.gltf', '.glb', '.ply', '.3mf']) {
    expect(getArtifactTypeByExtension(`model${extension}`)).toBe('model');
  }
  // Unrelated formats must keep their existing mapping.
  expect(getArtifactTypeByExtension('report.pdf')).toBe('document');
  expect(getArtifactTypeByExtension('photo.png')).toBe('image');
});

test('model artifacts preview from the file path and never load content', () => {
  expect(getArtifactPreviewMode('model')).toBe(ArtifactPreviewMode.Preview);
  for (const extension of ['.stl', '.obj', '.gltf', '.glb', '.ply', '.3mf']) {
    expect(isBinaryArtifactFile(`model${extension}`)).toBe(true);
  }
});

const REAL_STL_PATH = 'C:/Users/Administrator/Downloads/stl/Residential Buildings 010.stl';

test.skipIf(!require('fs').existsSync(REAL_STL_PATH))(
  'parses a real-world residential buildings STL via the preview loader',
  async () => {
    const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js');
    const buffer = readFileSync(REAL_STL_PATH);
    const arrayBuffer = buffer.buffer.slice(
      buffer.byteOffset,
      buffer.byteOffset + buffer.byteLength,
    );

    const geometry = new STLLoader().parse(arrayBuffer);
    geometry.computeVertexNormals();

    const position = geometry.getAttribute('position');
    expect(position).toBeTruthy();
    expect(position.count).toBeGreaterThan(0);
    // Triangles must be countable exactly the way ModelRenderer reports them.
    const triangles = geometry.index ? geometry.index.count / 3 : position.count / 3;
    expect(triangles).toBeGreaterThan(0);
    // The bounding box feeds the camera fit; it must be finite and non-empty.
    geometry.computeBoundingBox();
    const size = geometry.boundingBox?.getSize(new (require('three').Vector3)());
    expect(Number.isFinite(size.x) && Number.isFinite(size.y) && Number.isFinite(size.z)).toBe(
      true,
    );
    expect(Math.max(size.x, size.y, size.z)).toBeGreaterThan(0);
  },
);
