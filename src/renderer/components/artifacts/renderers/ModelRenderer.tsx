import { Button } from '@shared/components/ui/button';
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';

import type { Artifact } from '@/types/artifact';

interface ModelRendererProps {
  artifact: Artifact;
}

function getExtension(filePath: string): string {
  const lastDot = filePath.lastIndexOf('.');
  return lastDot === -1 ? '' : filePath.slice(lastDot).toLowerCase();
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  if (!/^data:[^,]*;base64,/i.test(dataUrl)) {
    return new TextEncoder().encode(dataUrl).buffer;
  }
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** Mirrors DocumentRenderer's file loading: content data URL first, then the
 * file path via the dialog bridge. Model files are binary-tagged, so real
 * artifacts always take the path branch. */
async function loadModelBuffer(artifact: Artifact): Promise<ArrayBuffer> {
  if (artifact.content) return dataUrlToArrayBuffer(artifact.content);
  if (!artifact.filePath) throw new Error('No content available');
  let filePath = artifact.filePath;
  if (filePath.startsWith('file:///')) filePath = filePath.slice(7);
  else if (filePath.startsWith('file://')) filePath = filePath.slice(7);
  else if (filePath.startsWith('file:/')) filePath = filePath.slice(5);
  if (/^\/[A-Za-z]:/.test(filePath)) filePath = filePath.slice(1);
  const result = await window.electron.dialog.readFileAsDataUrl(filePath);
  if (!result?.success || !result.dataUrl) {
    throw new Error(result?.error || 'Failed to read file');
  }
  return dataUrlToArrayBuffer(result.dataUrl);
}

function parseModelObject(extension: string, buffer: ArrayBuffer): THREE.Object3D {
  switch (extension) {
    case '.stl': {
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      return new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.1, roughness: 0.65 }),
      );
    }
    case '.ply': {
      const geometry = new PLYLoader().parse(buffer);
      geometry.computeVertexNormals();
      return new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({
          color: 0x9aa4b2,
          metalness: 0.1,
          roughness: 0.65,
          vertexColors: Boolean(geometry.getAttribute('color')),
          side: THREE.DoubleSide,
        }),
      );
    }
    case '.obj':
      return new OBJLoader().parse(new TextDecoder().decode(buffer));
    case '.gltf':
    case '.glb': {
      const loader = new GLTFLoader();
      let object: THREE.Object3D | null = null;
      // GLTFLoader.parse accepts a JSON string or an ArrayBuffer (GLB); the
      // callback style keeps it synchronous for our mount flow.
      loader.parse(
        extension === '.glb' ? buffer : new TextDecoder().decode(buffer),
        '',
        gltf => {
          object = gltf.scene;
        },
        undefined,
      );
      if (!object) throw new Error('Failed to parse glTF scene.');
      return object;
    }
    case '.3mf':
      return new ThreeMFLoader().parse(buffer);
    default:
      throw new Error(`Unsupported model format: ${extension}`);
  }
}

const ModelRenderer: React.FC<ModelRendererProps> = ({ artifact }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ triangles: number } | null>(null);
  const [resetKey, setResetKey] = useState(0);

  const extension = getExtension(artifact.filePath || artifact.fileName || '');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let frameId = 0;
    let cleanup: (() => void) | null = null;
    setError(null);
    setStats(null);

    const mount = async () => {
      try {
        const buffer = await loadModelBuffer(artifact);
        if (disposed) return;
        const object = parseModelObject(extension, buffer);

        const width = container.clientWidth || 800;
        const height = container.clientHeight || 480;
        const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setPixelRatio(window.devicePixelRatio);
        // updateStyle=false: the canvas is stretched by CSS (width/height
        // 100%), so live resizes never reallocate the drawing buffer per
        // pixel — that per-pixel reallocation is what blanks the GPU surface
        // while the panel divider is dragged.
        renderer.setSize(width, height, false);
        renderer.domElement.style.width = '100%';
        renderer.domElement.style.height = '100%';
        renderer.domElement.style.display = 'block';
        container.appendChild(renderer.domElement);

        const scene = new THREE.Scene();
        scene.add(new THREE.HemisphereLight(0xffffff, 0x475569, 2.2));
        const key = new THREE.DirectionalLight(0xffffff, 1.6);
        key.position.set(3, 6, 4);
        scene.add(key);

        // Normalize scale and center, whatever units the source file uses.
        const box = new THREE.Box3().setFromObject(object);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        const maxDimension = Math.max(size.x, size.y, size.z) || 1;
        const scale = 4 / maxDimension;
        object.scale.setScalar(scale);
        object.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        scene.add(object);

        const grid = new THREE.GridHelper(12, 24, 0x64748b, 0x334155);
        grid.position.y = (box.min.y - center.y) * scale - 0.01;
        scene.add(grid);

        const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100);
        camera.position.set(5, 4, 6);
        camera.lookAt(0, 0, 0);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.target.set(0, 0, 0);

        let triangles = 0;
        object.traverse(node => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh && mesh.geometry) {
            const position = mesh.geometry.getAttribute('position');
            if (position) triangles += mesh.geometry.index ? mesh.geometry.index.count / 3 : position.count / 3;
          }
        });
        setStats({ triangles: Math.round(triangles) });

        // The canvas is CSS-stretched, so the rendered image keeps tracking
        // the container live during drags; the drawing buffer itself is
        // re-allocated on a short debounce. Continuous re-allocation would
        // blank the GPU surface every frame the panel divider moves.
        const RESIZE_DEBOUNCE_MS = 120;
        let resizeTimer: number | null = null;
        const applyBufferSize = () => {
          resizeTimer = null;
          if (disposed) return;
          const w = container.clientWidth || width;
          const h = container.clientHeight || height;
          if (!w || !h) return;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h, false);
        };
        const scheduleBufferSize = () => {
          if (disposed) return;
          if (resizeTimer !== null) window.clearTimeout(resizeTimer);
          resizeTimer = window.setTimeout(applyBufferSize, RESIZE_DEBOUNCE_MS);
        };
        const resizeObserver = new ResizeObserver(scheduleBufferSize);
        resizeObserver.observe(container);

        const tick = () => {
          controls.update();
          renderer.render(scene, camera);
          frameId = requestAnimationFrame(tick);
        };
        tick();

        cleanup = () => {
          disposed = true;
          cancelAnimationFrame(frameId);
          if (resizeTimer !== null) window.clearTimeout(resizeTimer);
          resizeObserver.disconnect();
          controls.dispose();
          scene.traverse(node => {
            const mesh = node as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.geometry?.dispose();
              const material = mesh.material;
              if (Array.isArray(material)) material.forEach(entry => entry.dispose());
              else material?.dispose?.();
            }
          });
          renderer.dispose();
          renderer.domElement.remove();
        };
      } catch (e) {
        if (!disposed) {
          setError(e instanceof Error ? e.message : String(e));
        }
      }
    };

    void mount();
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [artifact, extension, resetKey]);

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full bg-background" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
          {error}
        </div>
      )}
      {!error && (
        <div className="absolute bottom-3 right-3 flex items-center gap-2">
          {stats && (
            <span className="rounded bg-surface-raised px-2 py-1 text-xs text-muted-foreground">
              {stats.triangles.toLocaleString()} triangles
            </span>
          )}
          <Button
            variant="secondary"
            size="sm"
            className="px-2 py-1 text-xs rounded"
            onClick={() => setResetKey(value => value + 1)}
          >
            Reset view
          </Button>
        </div>
      )}
    </div>
  );
};

export default ModelRenderer;
