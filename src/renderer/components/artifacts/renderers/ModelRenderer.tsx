import { Button } from '@shared/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@shared/components/ui/tooltip';
import { Pause, Rotate3D } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { PLYLoader } from 'three/examples/jsm/loaders/PLYLoader.js';
import { ThreeMFLoader } from 'three/examples/jsm/loaders/3MFLoader.js';

import type { Artifact } from '@/types/artifact';
import { i18nService } from '@/services/i18n';
import { loadArtifactDataUrl } from '@/services/artifactFileLoader';

import { MODEL_AUTO_ROTATE_SPEED, ModelFileExtension } from './constants';

interface ModelRendererProps {
  artifact: Artifact;
}

interface AutoRotationControls {
  autoRotate: boolean;
  autoRotateSpeed: number;
  addEventListener(type: 'start', listener: () => void): void;
  removeEventListener(type: 'start', listener: () => void): void;
}

interface ModelAutoRotationBinding {
  toggle(): boolean;
  dispose(): void;
}

export function bindModelAutoRotation(
  controls: AutoRotationControls,
  onChange: (isAutoRotating: boolean) => void,
): ModelAutoRotationBinding {
  controls.autoRotateSpeed = MODEL_AUTO_ROTATE_SPEED;

  const stopOnInteraction = () => {
    if (!controls.autoRotate) return;
    controls.autoRotate = false;
    onChange(false);
  };

  controls.addEventListener('start', stopOnInteraction);

  return {
    toggle: () => {
      controls.autoRotate = !controls.autoRotate;
      onChange(controls.autoRotate);
      return controls.autoRotate;
    },
    dispose: () => controls.removeEventListener('start', stopOnInteraction),
  };
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
  const dataUrl = await loadArtifactDataUrl(artifact.filePath);
  return dataUrlToArrayBuffer(dataUrl);
}

export async function parseModelObject(
  extension: string,
  buffer: ArrayBuffer,
): Promise<THREE.Object3D> {
  switch (extension) {
    case ModelFileExtension.Stl: {
      const geometry = new STLLoader().parse(buffer);
      geometry.computeVertexNormals();
      return new THREE.Mesh(
        geometry,
        new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.1, roughness: 0.65 }),
      );
    }
    case ModelFileExtension.Ply: {
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
    case ModelFileExtension.Obj:
      return new OBJLoader().parse(new TextDecoder().decode(buffer));
    case ModelFileExtension.Gltf:
    case ModelFileExtension.Glb: {
      const loader = new GLTFLoader();
      const gltf = await loader.parseAsync(
        extension === ModelFileExtension.Glb ? buffer : new TextDecoder().decode(buffer),
        '',
      );
      return gltf.scene;
    }
    case ModelFileExtension.ThreeMf:
      return new ThreeMFLoader().parse(buffer);
    default:
      throw new Error(`Unsupported model format: ${extension}`);
  }
}

const ModelRenderer: React.FC<ModelRendererProps> = ({ artifact }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const autoRotationRef = useRef<ModelAutoRotationBinding | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<{ triangles: number } | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [isAutoRotating, setIsAutoRotating] = useState(false);

  const extension = getExtension(artifact.filePath || artifact.fileName || '');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    let frameId = 0;
    let cleanup: (() => void) | null = null;
    setError(null);
    setStats(null);
    setIsAutoRotating(false);

    const mount = async () => {
      try {
        const buffer = await loadModelBuffer(artifact);
        if (disposed) return;
        const object = await parseModelObject(extension, buffer);
        if (disposed) return;

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
        // During live resizes the drawing buffer lags the container by a
        // debounce; object-fit keeps that stale frame letterboxed instead of
        // non-uniformly stretched, so the model never distorts mid-drag.
        renderer.domElement.style.objectFit = 'contain';
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
        const autoRotation = bindModelAutoRotation(controls, setIsAutoRotating);
        autoRotationRef.current = autoRotation;

        let triangles = 0;
        object.traverse(node => {
          const mesh = node as THREE.Mesh;
          if (mesh.isMesh && mesh.geometry) {
            const position = mesh.geometry.getAttribute('position');
            if (position)
              triangles += mesh.geometry.index ? mesh.geometry.index.count / 3 : position.count / 3;
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
          autoRotation.dispose();
          if (autoRotationRef.current === autoRotation) autoRotationRef.current = null;
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

  const autoRotateLabel = i18nService.t(
    isAutoRotating ? 'artifactModelAutoRotateStop' : 'artifactModelAutoRotateStart',
  );

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full bg-background" />
      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-sm">
          {error}
        </div>
      )}
      {!error && (
        <TooltipProvider delay={300}>
          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            {stats && (
              <span className="rounded bg-surface-raised px-2 py-1 text-xs text-muted-foreground">
                {stats.triangles.toLocaleString()} triangles
              </span>
            )}
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="secondary"
                    size="icon-sm"
                    disabled={!stats}
                    aria-label={autoRotateLabel}
                    aria-pressed={isAutoRotating}
                    onClick={() => autoRotationRef.current?.toggle()}
                  >
                    {isAutoRotating ? (
                      <Pause data-icon="inline-start" />
                    ) : (
                      <Rotate3D data-icon="inline-start" />
                    )}
                  </Button>
                }
              />
              <TooltipContent>{autoRotateLabel}</TooltipContent>
            </Tooltip>
            <Button
              variant="secondary"
              size="sm"
              className="px-2 py-1 text-xs"
              onClick={() => setResetKey(value => value + 1)}
            >
              Reset view
            </Button>
          </div>
        </TooltipProvider>
      )}
    </div>
  );
};

export default ModelRenderer;
