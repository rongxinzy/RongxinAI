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
// Floor for how long assemble may run when init finishes early.
const MIN_TOTAL_MS = 1100;
// After enough particles land, hold the formed mark briefly before disperse.
const BLOOM_HOLD_MS = 220;
// Safety: never block disperse forever if a few edge particles refuse to settle.
const MAX_ASSEMBLE_MS = 3200;
const SETTLE_RATIO = 0.99;
const PHYSICS_FRAME_MS = 1000 / 60;
const MAX_PHYSICS_STEPS = 4;
const DISPERSE_DURATION_MS = 480;
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

const resolveIsDark = (): boolean => {
  const root = document.documentElement;
  const themeId = root.dataset.theme ?? '';
  return root.classList.contains('dark') || themeId === 'classic-dark' || themeId.endsWith('-dark');
};

const logoSourceForTheme = (isDark: boolean): string =>
  isDark ? 'zhiyuan-logo-dark-1600.png' : 'zhiyuan-logo-light-1600.png';

/** 字标右上角的品牌蓝点。整字改成纯白/纯黑时必须留下，否则不像知远。 */
const isBrandAccent = (color: string): boolean => {
  const match = color.match(/rgb\((\d+),(\d+),(\d+)\)/);
  if (!match) return false;
  const red = Number(match[1]);
  const green = Number(match[2]);
  const blue = Number(match[3]);
  return blue >= 180 && red <= 80 && green >= 60 && green <= 180;
};

const BRAND_ACCENT = 'rgb(22,119,255)';

/** 解析 computed color。透明层不算深色，避免 rgba(0,0,0,0) 被误判。 */
const opaqueRgb = (color: string): [number, number, number] | null => {
  const match = color.match(
    /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/,
  );
  if (!match) return null;
  const alphaToken = match[4];
  const alpha =
    alphaToken === undefined
      ? 1
      : alphaToken.endsWith('%')
        ? Number(alphaToken.slice(0, -1)) / 100
        : Number(alphaToken);
  if (!Number.isFinite(alpha) || alpha < 0.5) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
};

/**
 * 只看最上层不透明背景。启动屏自己有底色时不再看 html，
 * 避免 html 已是深色、面板仍是浅色时把粒子画成白色。
 * 面板透明时才回退到 body / html。
 */
const bootSurfaceIsDark = (element: HTMLElement | null): boolean => {
  const candidates = [
    element ? getComputedStyle(element).backgroundColor : '',
    getComputedStyle(document.body).backgroundColor,
    getComputedStyle(document.documentElement).backgroundColor,
  ];
  for (const color of candidates) {
    const rgb = opaqueRgb(color);
    if (!rgb) continue;
    const luminance = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
    return luminance < 150;
  }
  return resolveIsDark();
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
    let lastFrameTime = 0;
    let assembleReadyAt = 0;
    let disperseStart = 0;
    let exitNotified = false;
    let cssWidth = 0;
    let cssHeight = 0;

    const stepAssemblePhysics = (elapsed: number) => {
      for (const particle of particles) {
        if (particle.settled) continue;
        if (elapsed < particle.delay) {
          // Pre-delay: dust drifts in place.
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
        const distance = Math.hypot(particle.tx - particle.x, particle.ty - particle.y);
        const speed = Math.hypot(particle.vx, particle.vy);
        if (distance < 1.2 && speed < 0.6) {
          particle.settled = true;
          particle.x = particle.tx;
          particle.y = particle.ty;
        }
      }
    };

    const countSettledRatio = (): number => {
      if (particles.length === 0) return 0;
      let settled = 0;
      for (const particle of particles) {
        if (particle.settled) settled += 1;
      }
      return settled / particles.length;
    };

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
      if (!lastFrameTime) lastFrameTime = now;
      const elapsed = now - mountTime;

      if (phase === Phase.Assemble) {
        // Spring steps are frame-based; catch up on slow frames so wall-clock
        // settle time stays close to 60fps instead of stretching with jank.
        const frameBudget = Math.min(now - lastFrameTime, PHYSICS_FRAME_MS * MAX_PHYSICS_STEPS);
        lastFrameTime = now;
        const steps = Math.max(1, Math.round(frameBudget / PHYSICS_FRAME_MS));
        for (let step = 0; step < steps; step += 1) {
          stepAssemblePhysics(elapsed);
        }

        if (!assembleReadyAt && countSettledRatio() >= SETTLE_RATIO) {
          assembleReadyAt = now;
        }

        const bloomReady = assembleReadyAt > 0 && now - assembleReadyAt >= BLOOM_HOLD_MS;
        const assembleTimedOut = elapsed >= MAX_ASSEMBLE_MS;
        // Wait for the mark to finish forming (then a short bloom) before disperse,
        // even if the main process already signaled exiting.
        if (exitingRef.current && elapsed >= MIN_TOTAL_MS && (bloomReady || assembleTimedOut)) {
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
      // 每帧按启动屏实际背景取反色，不使用 logo 采样色（深色 logo 接近白，浅色 logo 接近黑）。
      const paintWhite = bootSurfaceIsDark(container);
      ctx.globalCompositeOperation = 'source-over';

      for (const particle of particles) {
        let alpha = particle.baseAlpha * fadeIn;

        if (phase === Phase.Assemble) {
          if (particle.settled) {
            // Breathing shimmer once locked onto the logo.
            const shimmer = 0.8 + 0.2 * Math.sin(now * 0.0016 + particle.jitterPhase);
            alpha *= shimmer;
            particle.x = particle.tx + Math.sin(now * 0.0011 + particle.jitterPhase) * 0.7;
            particle.y = particle.ty + Math.cos(now * 0.0009 + particle.jitterPhase) * 0.7;
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

        if (isBrandAccent(particle.color)) {
          ctx.fillStyle = BRAND_ACCENT;
          ctx.globalAlpha = Math.min(1, Math.max(alpha, fadeIn * 0.92));
        } else if (paintWhite) {
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = Math.min(1, Math.max(alpha, fadeIn * 0.92));
        } else {
          ctx.fillStyle = '#141820';
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
