import React, { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';

/**
 * Boot splash: dust particles drift in from a scattered field, assemble into
 * the ZhiYuan logo, hold while the app initializes, then disperse outward
 * before the main shell mounts. Honors prefers-reduced-motion with a static
 * logo fallback.
 */

const Phase = {
  Assemble: 'assemble',
  Disperse: 'disperse',
} as const;
type Phase = (typeof Phase)[keyof typeof Phase];

const MAX_PARTICLES = 4200;
const ALPHA_THRESHOLD = 140;
/** Logo must be fully assembled and held this long before exit is allowed. */
const MIN_TOTAL_MS = 2400;
const DISPERSE_DURATION_MS = 750;
const FADE_IN_MS = 420;
/** Logo display width caps (fraction of container, absolute px). */
const LOGO_WIDTH_RATIO = 0.42;
const LOGO_WIDTH_MAX_PX = 440;
/** Pixels sampled below this stride area are skipped to cap particle count. */
const ANALYSIS_WIDTH_PX = 480;

interface SampledLogo {
  /** Points in analysis-bitmap coordinates, already cropped to content bbox. */
  points: Array<{ x: number; y: number; color: string; alpha: number }>;
  contentWidth: number;
  contentHeight: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  size: number;
  color: string;
  baseAlpha: number;
  delay: number;
  stiffness: number;
  damping: number;
  jitterPhase: number;
  settled: boolean;
}

const resolveIsDark = (): boolean =>
  document.documentElement.classList.contains('dark') ||
  document.documentElement.dataset.theme === 'classic-dark';

const logoSourceForTheme = (isDark: boolean): string =>
  isDark ? 'zhiyuan-logo-dark-1600.png' : 'zhiyuan-logo-light-1600.png';

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

      // Content bounding box of opaque pixels (logo PNGs have wide margins).
      let minX = w;
      let minY = h;
      let maxX = -1;
      let maxY = -1;
      let opaqueCount = 0;
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
          const alpha = data[(y * w + x) * 4 + 3];
          if (alpha > ALPHA_THRESHOLD) {
            opaqueCount += 1;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (opaqueCount === 0) {
        reject(new Error('logo has no opaque pixels'));
        return;
      }

      const stride = Math.max(1, Math.round(Math.sqrt(opaqueCount / MAX_PARTICLES)));
      const points: SampledLogo['points'] = [];
      for (let y = minY; y <= maxY; y += stride) {
        for (let x = minX; x <= maxX; x += stride) {
          const offset = (y * w + x) * 4;
          const alpha = data[offset + 3];
          if (alpha <= ALPHA_THRESHOLD) continue;
          points.push({
            x: x - minX,
            y: y - minY,
            color: `rgb(${data[offset]},${data[offset + 1]},${data[offset + 2]})`,
            alpha: alpha / 255,
          });
        }
      }
      resolve({
        points,
        contentWidth: maxX - minX + 1,
        contentHeight: maxY - minY + 1,
      });
    };
    image.onerror = () => reject(new Error(`failed to load ${src}`));
    image.src = src;
  });

interface ParticleBootScreenProps {
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
  const [isDark] = useState(resolveIsDark);
  const [reducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  );
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    exitingRef.current = exiting;
  }, [exiting]);
  useEffect(() => {
    onExitCompleteRef.current = onExitComplete;
  }, [onExitComplete]);

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
    let disperseStart = 0;
    let exitNotified = false;
    let cssWidth = 0;
    let cssHeight = 0;

    const layoutTargets = () => {
      if (!sampled || cssWidth === 0 || cssHeight === 0) return;
      const displayWidth = Math.min(cssWidth * LOGO_WIDTH_RATIO, LOGO_WIDTH_MAX_PX);
      const scale = displayWidth / sampled.contentWidth;
      const displayHeight = sampled.contentHeight * scale;
      const offsetX = (cssWidth - displayWidth) / 2;
      // Slight upward bias leaves visual room for the status line below.
      const offsetY = (cssHeight - displayHeight) / 2 - 20;
      const centerX = cssWidth / 2;
      const centerY = cssHeight / 2;
      const maxDist = Math.hypot(centerX, centerY) || 1;
      particles.forEach((particle, index) => {
        const point = sampled!.points[index % sampled!.points.length];
        particle.tx = offsetX + point.x * scale;
        particle.ty = offsetY + point.y * scale;
        // Assembly ripples outward from the logo center.
        const dist = Math.hypot(particle.tx - centerX, particle.ty - centerY);
        particle.delay = 140 + (dist / maxDist) * 420 + Math.random() * 140;
      });
    };

    const buildParticles = () => {
      if (!sampled) return;
      particles = sampled.points.map(point => ({
        x: Math.random() * cssWidth,
        y: Math.random() * cssHeight,
        vx: (Math.random() - 0.5) * 0.6,
        vy: (Math.random() - 0.5) * 0.6,
        tx: 0,
        ty: 0,
        size: 1.4 + Math.random() * 1.1,
        color: point.color,
        baseAlpha: point.alpha,
        delay: 0,
        stiffness: 0.014 + Math.random() * 0.014,
        damping: 0.88 + Math.random() * 0.05,
        jitterPhase: Math.random() * Math.PI * 2,
        settled: false,
      }));
      layoutTargets();
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
      layoutTargets();
    };

    const beginDisperse = (now: number) => {
      phase = Phase.Disperse;
      disperseStart = now;
      const centerX = cssWidth / 2;
      const centerY = cssHeight / 2;
      for (const particle of particles) {
        const angle =
          Math.atan2(particle.ty - centerY, particle.tx - centerX) + (Math.random() - 0.5) * 0.9;
        const speed = 1.6 + Math.random() * 4.2;
        particle.vx = Math.cos(angle) * speed;
        particle.vy = Math.sin(angle) * speed - 0.7;
        particle.settled = false;
        particle.delay = Math.random() * 160;
      }
    };

    const tick = (now: number) => {
      if (disposed) return;
      if (!mountTime) mountTime = now;
      const elapsed = now - mountTime;

      if (phase === Phase.Assemble && exitingRef.current && elapsed >= MIN_TOTAL_MS) {
        beginDisperse(now);
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

      for (const particle of particles) {
        let alpha = particle.baseAlpha * fadeIn;

        if (phase === Phase.Assemble) {
          if (particle.settled) {
            // Breathing shimmer once locked onto the logo.
            const shimmer = 0.8 + 0.2 * Math.sin(now * 0.0016 + particle.jitterPhase);
            alpha *= shimmer;
            particle.x = particle.tx + Math.sin(now * 0.0011 + particle.jitterPhase) * 0.7;
            particle.y = particle.ty + Math.cos(now * 0.0009 + particle.jitterPhase) * 0.7;
          } else if (elapsed >= particle.delay) {
            particle.vx += (particle.tx - particle.x) * particle.stiffness;
            particle.vy += (particle.ty - particle.y) * particle.stiffness;
            particle.vx *= particle.damping;
            particle.vy *= particle.damping;
            particle.x += particle.vx;
            particle.y += particle.vy;
            const distance = Math.hypot(particle.tx - particle.x, particle.ty - particle.y);
            const speed = Math.hypot(particle.vx, particle.vy);
            if (distance < 1.2 && speed < 0.6) {
              particle.settled = true;
              particle.x = particle.tx;
              particle.y = particle.ty;
            }
          } else {
            // Pre-delay: dust drifts in place.
            particle.x += particle.vx;
            particle.y += particle.vy;
          }
        } else {
          // Disperse: decelerating outward drift with a slight upward lift.
          const disperseElapsed = now - disperseStart - particle.delay;
          if (disperseElapsed > 0) {
            particle.vx *= 0.986;
            particle.vy = particle.vy * 0.986 - 0.02;
            particle.x += particle.vx;
            particle.y += particle.vy;
            alpha *= Math.max(0, 1 - disperseElapsed / (DISPERSE_DURATION_MS - 160));
          }
        }

        ctx.globalAlpha = alpha;
        ctx.fillStyle = particle.color;
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
        buildParticles();
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
          <canvas ref={canvasRef} className="absolute inset-0" aria-hidden="true" />
          <p className="absolute inset-x-0 bottom-14 text-center text-sm text-muted-foreground motion-safe:animate-pulse">
            {i18nService.t('loading')}
          </p>
        </>
      )}
    </div>
  );
};
