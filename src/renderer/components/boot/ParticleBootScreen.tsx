import React, { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';

/**
 * Boot splash: dust particles drift in from a scattered field, assemble into
 * the ZhiYuan logo, hold with a subtle breathing shimmer while the app initializes,
 * then disperse outward before the main shell mounts.
 *
 * Honors prefers-reduced-motion with a static logo fallback.
 */

const Phase = {
  Assemble: 'assemble',
  Disperse: 'disperse',
} as const;
type Phase = (typeof Phase)[keyof typeof Phase];

const MAX_PARTICLES = 4200;
const ALPHA_THRESHOLD = 140;
const MIN_ASSEMBLE_MS = 1200;
const BLOOM_HOLD_MS = 160;
const MAX_ASSEMBLE_MS = 2200;
const ASSEMBLE_RATIO_TARGET = 0.85;
const DISPERSE_DURATION_MS = 420;
const FADE_IN_MS = 380;
const TARGET_FRAME_MS = 1000 / 60;
const MAX_PHYSICS_STEPS = 2;
const LOGO_WIDTH_RATIO = 0.42;
const LOGO_WIDTH_MAX_PX = 440;
const ANALYSIS_WIDTH_PX = 480;

export const BRAND_ACCENT = 'rgb(22,119,255)';
export const BODY_COLOR_DARK = '#ffffff';
export const BODY_COLOR_LIGHT = '#141820';

interface SampledPoint {
  x: number;
  y: number;
  isAccent: boolean;
  alpha: number;
}

export interface SampledLogo {
  points: SampledPoint[];
  contentWidth: number;
  contentHeight: number;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  size: number;
  isAccent: boolean;
  baseAlpha: number;
  delay: number;
  stiffness: number;
  damping: number;
  jitterPhase: number;
  settled: boolean;
}

/**
 * Checks if an RGB triplet represents the ZhiYuan brand blue dot in the wordmark.
 * Evaluated once during logo image analysis, never in the rendering loop.
 */
export const isBrandAccentColor = (r: number, g: number, b: number): boolean =>
  b >= 180 && r <= 80 && g >= 60 && g <= 180;

export const resolveIsDark = (): boolean => {
  if (typeof document === 'undefined') return false;
  const root = document.documentElement;
  const themeId = root.dataset.theme ?? '';
  return root.classList.contains('dark') || themeId === 'classic-dark' || themeId.endsWith('-dark');
};

const logoSourceForTheme = (isDark: boolean): string =>
  isDark ? 'zhiyuan-logo-dark-1600.png' : 'zhiyuan-logo-light-1600.png';

export interface ExitEvaluationParams {
  exiting: boolean;
  elapsed: number;
  now: number;
  assembleReadyAt: number;
  minAssembleMs?: number;
  maxAssembleMs?: number;
  bloomHoldMs?: number;
}

/**
 * Deterministic exit evaluation.
 *
 * Prevents premature exit before logo assembly is visible, while guaranteeing
 * the splash screen never hangs or waits on flaky spring settling thresholds.
 */
export const shouldBeginDisperse = ({
  exiting,
  elapsed,
  now,
  assembleReadyAt,
  minAssembleMs = MIN_ASSEMBLE_MS,
  maxAssembleMs = MAX_ASSEMBLE_MS,
  bloomHoldMs = BLOOM_HOLD_MS,
}: ExitEvaluationParams): boolean => {
  if (!exiting) return false;

  // Hard ceiling: app is ready and we've reached the upper assemble budget
  if (elapsed >= maxAssembleMs) return true;

  // Ensure minimum assemble duration so particles don't flash and vanish
  if (elapsed < minAssembleMs) return false;

  // Disperse once assemble bloom hold is satisfied, or after soft timeout (1500ms)
  const isBloomReady = assembleReadyAt > 0 && now - assembleReadyAt >= bloomHoldMs;
  return isBloomReady || elapsed >= 1500;
};

export const sampleLogoData = (
  data: Uint8ClampedArray | number[],
  w: number,
  h: number,
  maxParticles = MAX_PARTICLES,
  alphaThreshold = ALPHA_THRESHOLD,
): SampledLogo | null => {
  let minX = w;
  let minY = h;
  let maxX = -1;
  let maxY = -1;
  let opaqueCount = 0;

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const alpha = data[(y * w + x) * 4 + 3];
      if (alpha > alphaThreshold) {
        opaqueCount += 1;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  if (opaqueCount === 0 || maxX < minX || maxY < minY) {
    return null;
  }

  const stride = Math.max(1, Math.round(Math.sqrt(opaqueCount / maxParticles)));
  const points: SampledPoint[] = [];

  for (let y = minY; y <= maxY; y += stride) {
    for (let x = minX; x <= maxX; x += stride) {
      const offset = (y * w + x) * 4;
      const alpha = data[offset + 3];
      if (alpha <= alphaThreshold) continue;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      points.push({
        x: x - minX,
        y: y - minY,
        isAccent: isBrandAccentColor(r, g, b),
        alpha: alpha / 255,
      });
    }
  }

  return {
    points,
    contentWidth: maxX - minX + 1,
    contentHeight: maxY - minY + 1,
  };
};

export const createParticlesFromSampledLogo = (
  sampled: SampledLogo,
  cssWidth: number,
  cssHeight: number,
): Particle[] => {
  const displayWidth = Math.min(cssWidth * LOGO_WIDTH_RATIO, LOGO_WIDTH_MAX_PX);
  const scale = sampled.contentWidth > 0 ? displayWidth / sampled.contentWidth : 1;
  const displayHeight = sampled.contentHeight * scale;
  const offsetX = (cssWidth - displayWidth) / 2;
  const offsetY = (cssHeight - displayHeight) / 2 - 20;
  const centerX = cssWidth / 2;
  const centerY = cssHeight / 2;
  const maxDist = Math.hypot(centerX, centerY) || 1;

  return sampled.points.map(point => {
    const tx = offsetX + point.x * scale;
    const ty = offsetY + point.y * scale;
    const dist = Math.hypot(tx - centerX, ty - centerY);
    return {
      x: Math.random() * cssWidth,
      y: Math.random() * cssHeight,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      tx,
      ty,
      size: 1.4 + Math.random() * 1.1,
      isAccent: point.isAccent,
      baseAlpha: point.alpha,
      delay: 100 + (dist / maxDist) * 320 + Math.random() * 80,
      stiffness: 0.024 + Math.random() * 0.012,
      damping: 0.86 + Math.random() * 0.04,
      jitterPhase: Math.random() * Math.PI * 2,
      settled: false,
    };
  });
};

export const updateParticleTargets = (
  particles: Particle[],
  sampled: SampledLogo,
  cssWidth: number,
  cssHeight: number,
): void => {
  const displayWidth = Math.min(cssWidth * LOGO_WIDTH_RATIO, LOGO_WIDTH_MAX_PX);
  const scale = sampled.contentWidth > 0 ? displayWidth / sampled.contentWidth : 1;
  const displayHeight = sampled.contentHeight * scale;
  const offsetX = (cssWidth - displayWidth) / 2;
  const offsetY = (cssHeight - displayHeight) / 2 - 20;
  const centerX = cssWidth / 2;
  const centerY = cssHeight / 2;
  const maxDist = Math.hypot(centerX, centerY) || 1;

  particles.forEach((particle, index) => {
    const point = sampled.points[index % sampled.points.length];
    particle.tx = offsetX + point.x * scale;
    particle.ty = offsetY + point.y * scale;
    const dist = Math.hypot(particle.tx - centerX, particle.ty - centerY);
    particle.delay = 100 + (dist / maxDist) * 320 + Math.random() * 80;
  });
};

export const stepAssemblePhysics = (particles: Particle[], elapsed: number): number => {
  let newlySettled = 0;
  for (const particle of particles) {
    if (particle.settled) continue;
    if (elapsed < particle.delay) {
      particle.x += particle.vx;
      particle.y += particle.vy;
      continue;
    }
    particle.vx += (particle.tx - particle.x) * particle.stiffness;
    particle.vy += (particle.ty - particle.y) * particle.stiffness;
    particle.vx *= particle.damping;
    particle.vy *= particle.damping;
    particle.x += particle.vx;
    particle.y += particle.vy;

    const dx = particle.tx - particle.x;
    const dy = particle.ty - particle.y;
    if (dx * dx + dy * dy < 2.0 && particle.vx * particle.vx + particle.vy * particle.vy < 0.5) {
      particle.settled = true;
      particle.x = particle.tx;
      particle.y = particle.ty;
      newlySettled += 1;
    }
  }
  return newlySettled;
};

export const initDisperse = (particles: Particle[], centerX: number, centerY: number): void => {
  for (const particle of particles) {
    const angle =
      Math.atan2(particle.y - centerY, particle.x - centerX) + (Math.random() - 0.5) * 0.8;
    const speed = 1.8 + Math.random() * 3.6;
    particle.vx = Math.cos(angle) * speed;
    particle.vy = Math.sin(angle) * speed - 0.6;
    particle.settled = false;
    particle.delay = Math.random() * 120;
  }
};

const loadSampledLogo = (src: string): Promise<SampledLogo> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const scale = ANALYSIS_WIDTH_PX / image.naturalWidth;
      const w = ANALYSIS_WIDTH_PX;
      const h = Math.max(1, Math.round(image.naturalHeight * scale));
      const offscreen = document.createElement('canvas');
      offscreen.width = w;
      offscreen.height = h;
      const ctx = offscreen.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        reject(new Error('2d context unavailable'));
        return;
      }
      ctx.drawImage(image, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const sampled = sampleLogoData(data, w, h);
      if (!sampled) {
        reject(new Error('logo has no opaque pixels'));
        return;
      }
      resolve(sampled);
    };
    image.onerror = () => reject(new Error(`failed to load ${src}`));
    image.src = src;
  });

export interface ParticleBootScreenProps {
  /** Flip to true when app init finished; particles disperse, then onExitComplete fires. */
  exiting: boolean;
  onExitComplete: () => void;
}

export const ParticleBootScreen: React.FC<ParticleBootScreenProps> = ({
  exiting,
  onExitComplete,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const exitingRef = useRef(exiting);
  const onExitCompleteRef = useRef(onExitComplete);
  const [isDark, setIsDark] = useState(resolveIsDark);
  const [reducedMotion] = useState(
    () =>
      typeof window !== 'undefined' &&
      (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false),
  );
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    exitingRef.current = exiting;
  }, [exiting]);

  useEffect(() => {
    onExitCompleteRef.current = onExitComplete;
  }, [onExitComplete]);

  // Keep isDark reactive to HTML attribute/theme changes without per-frame DOM queries
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const updateTheme = () => setIsDark(resolveIsDark());
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  const staticMode = reducedMotion || imageFailed;

  // Static fallback: quick fade-out once the app is ready.
  useEffect(() => {
    if (!staticMode || !exiting) return;
    const timer = window.setTimeout(() => onExitCompleteRef.current(), 240);
    return () => window.clearTimeout(timer);
  }, [staticMode, exiting]);

  useEffect(() => {
    if (staticMode) return;
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;
    let disposed = false;
    let particles: Particle[] = [];
    let sampled: SampledLogo | null = null;
    let phase: Phase = Phase.Assemble;
    let mountTime = 0;
    let lastFrameTime = 0;
    let physicsAccumulator = 0;
    let settledCount = 0;
    let assembleReadyAt = 0;
    let disperseStart = 0;
    let exitNotified = false;
    let cssWidth = 0;
    let cssHeight = 0;

    const beginDisperse = (now: number) => {
      phase = Phase.Disperse;
      disperseStart = now;
      initDisperse(particles, cssWidth / 2, cssHeight / 2);
    };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      cssWidth = rect.width;
      cssHeight = rect.height;
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (sampled && particles.length > 0) {
        updateParticleTargets(particles, sampled, cssWidth, cssHeight);
      }
    };

    const tick = (now: number) => {
      if (disposed) return;
      if (!mountTime) mountTime = now;
      if (!lastFrameTime) lastFrameTime = now;
      const elapsed = now - mountTime;
      const delta = Math.min(now - lastFrameTime, 64);
      lastFrameTime = now;

      if (phase === Phase.Assemble) {
        physicsAccumulator += delta;
        let steps = 0;
        while (physicsAccumulator >= TARGET_FRAME_MS && steps < MAX_PHYSICS_STEPS) {
          const newlySettled = stepAssemblePhysics(particles, elapsed);
          settledCount += newlySettled;
          physicsAccumulator -= TARGET_FRAME_MS;
          steps += 1;
        }
        if (physicsAccumulator > TARGET_FRAME_MS * 2) {
          physicsAccumulator = 0;
        }

        if (
          !assembleReadyAt &&
          particles.length > 0 &&
          settledCount / particles.length >= ASSEMBLE_RATIO_TARGET
        ) {
          assembleReadyAt = now;
        }

        if (
          shouldBeginDisperse({
            exiting: exitingRef.current,
            elapsed,
            now,
            assembleReadyAt,
          })
        ) {
          beginDisperse(now);
        }
      }

      if (phase === Phase.Disperse && now - disperseStart >= DISPERSE_DURATION_MS) {
        if (!exitNotified) {
          exitNotified = true;
          onExitCompleteRef.current();
        }
        return;
      }

      ctx.clearRect(0, 0, cssWidth, cssHeight);
      const fadeIn = Math.min(1, elapsed / FADE_IN_MS);
      const bodyColor = isDark ? BODY_COLOR_DARK : BODY_COLOR_LIGHT;

      for (const particle of particles) {
        let alpha = particle.baseAlpha * fadeIn;

        if (phase === Phase.Assemble) {
          if (particle.settled) {
            const shimmer = 0.8 + 0.2 * Math.sin(now * 0.0016 + particle.jitterPhase);
            alpha *= shimmer;
            particle.x = particle.tx + Math.sin(now * 0.0011 + particle.jitterPhase) * 0.7;
            particle.y = particle.ty + Math.cos(now * 0.0009 + particle.jitterPhase) * 0.7;
          }
        } else {
          const disperseElapsed = now - disperseStart - particle.delay;
          if (disperseElapsed > 0) {
            particle.vx *= 0.986;
            particle.vy = particle.vy * 0.986 - 0.02;
            particle.x += particle.vx;
            particle.y += particle.vy;
            alpha *= Math.max(0, 1 - disperseElapsed / (DISPERSE_DURATION_MS - 160));
          }
        }

        if (particle.isAccent) {
          ctx.fillStyle = BRAND_ACCENT;
          ctx.globalAlpha = Math.min(1, Math.max(alpha, fadeIn * 0.92));
        } else {
          ctx.fillStyle = bodyColor;
          ctx.globalAlpha = Math.min(1, Math.max(alpha, fadeIn * 0.92));
        }
        ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
      }
      ctx.globalAlpha = 1;

      rafId = window.requestAnimationFrame(tick);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();

    loadSampledLogo(logoSourceForTheme(isDark))
      .then(result => {
        if (disposed) return;
        sampled = result;
        particles = createParticlesFromSampledLogo(result, cssWidth, cssHeight);
        settledCount = 0;
        rafId = window.requestAnimationFrame(tick);
      })
      .catch(() => {
        if (!disposed) setImageFailed(true);
      });

    return () => {
      disposed = true;
      window.cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [staticMode, isDark]);

  return (
    <div
      ref={containerRef}
      role="status"
      aria-live="polite"
      className={`relative flex-1 min-h-0 bg-background overflow-hidden transition-opacity duration-200 ${
        staticMode && exiting ? 'opacity-0' : 'opacity-100'
      }`}
    >
      {staticMode ? (
        <div className="flex h-full flex-col items-center justify-center gap-8">
          <img
            src={logoSourceForTheme(isDark)}
            alt="知远"
            className="w-[min(42vw,320px)] select-none"
            draggable={false}
          />
          <p className="text-sm text-muted-foreground">{i18nService.t('loading')}</p>
        </div>
      ) : (
        <>
          <canvas
            ref={canvasRef}
            className="absolute inset-0 z-10"
            style={{ mixBlendMode: 'normal' }}
            aria-hidden="true"
          />
          <p className="absolute inset-x-0 bottom-14 text-center text-sm text-muted-foreground motion-safe:animate-pulse">
            {i18nService.t('loading')}
          </p>
        </>
      )}
    </div>
  );
};
