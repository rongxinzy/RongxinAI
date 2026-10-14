// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  BODY_COLOR_DARK,
  BODY_COLOR_LIGHT,
  BRAND_ACCENT,
  createParticlesFromSampledLogo,
  initDisperse,
  isBrandAccentColor,
  ParticleBootScreen,
  resolveIsDark,
  sampleLogoData,
  shouldBeginDisperse,
  stepAssemblePhysics,
  updateParticleTargets,
} from './ParticleBootScreen';
import type { Particle, SampledLogo } from './ParticleBootScreen';

describe('ParticleBootScreen', () => {
  describe('isBrandAccentColor', () => {
    it('accurately identifies the ZhiYuan brand blue dot', () => {
      // rgb(22, 119, 255)
      expect(isBrandAccentColor(22, 119, 255)).toBe(true);
      // boundary acceptance
      expect(isBrandAccentColor(80, 180, 180)).toBe(true);
      expect(isBrandAccentColor(0, 60, 255)).toBe(true);
    });

    it('rejects dark text, white, gray, red, and green pixels', () => {
      expect(isBrandAccentColor(20, 24, 32)).toBe(false); // dark body
      expect(isBrandAccentColor(255, 255, 255)).toBe(false); // white
      expect(isBrandAccentColor(128, 128, 128)).toBe(false); // neutral gray
      expect(isBrandAccentColor(255, 0, 0)).toBe(false); // pure red
      expect(isBrandAccentColor(0, 255, 0)).toBe(false); // pure green
      expect(isBrandAccentColor(100, 100, 255)).toBe(false); // too high red
      expect(isBrandAccentColor(50, 200, 255)).toBe(false); // too high green
      expect(isBrandAccentColor(0, 100, 150)).toBe(false); // blue too low (< 180)
    });
  });

  describe('resolveIsDark', () => {
    it('detects dark theme based on document class or data-theme attribute', () => {
      const root = document.documentElement;
      const originalClass = root.className;
      const originalTheme = root.dataset.theme;

      try {
        root.className = 'dark';
        delete root.dataset.theme;
        expect(resolveIsDark()).toBe(true);

        root.className = '';
        root.dataset.theme = 'classic-dark';
        expect(resolveIsDark()).toBe(true);

        root.dataset.theme = 'changan-dark';
        expect(resolveIsDark()).toBe(true);

        root.dataset.theme = 'classic-light';
        expect(resolveIsDark()).toBe(false);

        root.className = '';
        delete root.dataset.theme;
        expect(resolveIsDark()).toBe(false);
      } finally {
        root.className = originalClass;
        if (originalTheme !== undefined) {
          root.dataset.theme = originalTheme;
        } else {
          delete root.dataset.theme;
        }
      }
    });
  });

  describe('sampleLogoData', () => {
    it('returns null when image contains no opaque pixels', () => {
      // 2x2 transparent RGBA
      const transparentData = new Uint8ClampedArray(16);
      expect(sampleLogoData(transparentData, 2, 2)).toBeNull();
    });

    it('samples points, calculates content bounding box, and marks brand accent', () => {
      // 4x4 image with opaque content at (1,1) body color and (2,1) brand accent
      const w = 4;
      const h = 4;
      const data = new Uint8ClampedArray(w * h * 4);

      // (1, 1): dark body pixel
      const idx1 = (1 * w + 1) * 4;
      data[idx1] = 20;
      data[idx1 + 1] = 24;
      data[idx1 + 2] = 32;
      data[idx1 + 3] = 255;

      // (2, 1): brand blue dot pixel rgb(22, 119, 255)
      const idx2 = (1 * w + 2) * 4;
      data[idx2] = 22;
      data[idx2 + 1] = 119;
      data[idx2 + 2] = 255;
      data[idx2 + 3] = 255;

      const sampled = sampleLogoData(data, w, h, 100);
      expect(sampled).not.toBeNull();
      expect(sampled?.contentWidth).toBe(2);
      expect(sampled?.contentHeight).toBe(1);
      expect(sampled?.points.length).toBe(2);

      const bodyPoint = sampled?.points.find(p => !p.isAccent);
      const accentPoint = sampled?.points.find(p => p.isAccent);

      expect(bodyPoint).toBeDefined();
      expect(accentPoint).toBeDefined();
      expect(accentPoint?.isAccent).toBe(true);
      expect(bodyPoint?.isAccent).toBe(false);
    });
  });

  describe('createParticlesFromSampledLogo and updateParticleTargets', () => {
    const mockSampled: SampledLogo = {
      contentWidth: 100,
      contentHeight: 40,
      points: [
        { x: 10, y: 10, isAccent: false, alpha: 1 },
        { x: 90, y: 10, isAccent: true, alpha: 1 },
      ],
    };

    it('initializes particle field within container bounds', () => {
      const particles = createParticlesFromSampledLogo(mockSampled, 800, 600);
      expect(particles.length).toBe(2);

      for (const p of particles) {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(800);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(600);
        expect(p.tx).toBeGreaterThan(0);
        expect(p.ty).toBeGreaterThan(0);
        expect(p.settled).toBe(false);
        expect(p.delay).toBeGreaterThanOrEqual(100);
      }

      expect(particles[1].isAccent).toBe(true);
      expect(particles[0].isAccent).toBe(false);
    });

    it('updates targets dynamically on container resize', () => {
      const particles = createParticlesFromSampledLogo(mockSampled, 800, 600);
      const oldTx = particles[0].tx;
      const oldTy = particles[0].ty;

      updateParticleTargets(particles, mockSampled, 1200, 900);
      expect(particles[0].tx).not.toBe(oldTx);
      expect(particles[0].ty).not.toBe(oldTy);
    });
  });

  describe('stepAssemblePhysics', () => {
    const createTestParticle = (overrides: Partial<Particle> = {}): Particle => ({
      x: 0,
      y: 0,
      vx: 0.1,
      vy: 0.1,
      tx: 100,
      ty: 100,
      size: 2,
      isAccent: false,
      baseAlpha: 1,
      delay: 200,
      stiffness: 0.03,
      damping: 0.9,
      jitterPhase: 0,
      settled: false,
      ...overrides,
    });

    it('keeps particle in pre-delay drifting state when elapsed < delay', () => {
      const p = createTestParticle({ x: 10, y: 10, vx: 1, vy: 2, delay: 200 });
      const newlySettled = stepAssemblePhysics([p], 100);

      expect(newlySettled).toBe(0);
      expect(p.x).toBe(11);
      expect(p.y).toBe(12);
      expect(p.settled).toBe(false);
    });

    it('pulls particle toward target when elapsed >= delay', () => {
      const p = createTestParticle({ x: 0, y: 0, tx: 100, ty: 100, delay: 200 });
      stepAssemblePhysics([p], 250);

      expect(p.vx).toBeGreaterThan(0);
      expect(p.vy).toBeGreaterThan(0);
      expect(p.x).toBeGreaterThan(0);
      expect(p.y).toBeGreaterThan(0);
      expect(p.settled).toBe(false);
    });

    it('settles particle when close to target with low speed and increments newlySettled', () => {
      const p = createTestParticle({
        x: 99.5,
        y: 100.2,
        vx: 0.1,
        vy: 0.1,
        tx: 100,
        ty: 100,
        delay: 0,
      });

      const newlySettled = stepAssemblePhysics([p], 500);
      expect(newlySettled).toBe(1);
      expect(p.settled).toBe(true);
      expect(p.x).toBe(100);
      expect(p.y).toBe(100);

      // Subsequent steps do not re-settle or re-count
      const secondStepSettled = stepAssemblePhysics([p], 516);
      expect(secondStepSettled).toBe(0);
    });
  });

  describe('initDisperse', () => {
    it('applies outward dispersion velocity and resets settled flag', () => {
      const particles: Particle[] = [
        {
          x: 450,
          y: 350,
          vx: 0,
          vy: 0,
          tx: 450,
          ty: 350,
          size: 2,
          isAccent: false,
          baseAlpha: 1,
          delay: 0,
          stiffness: 0.03,
          damping: 0.9,
          jitterPhase: 0,
          settled: true,
        },
      ];

      initDisperse(particles, 400, 300);
      expect(particles[0].settled).toBe(false);
      expect(particles[0].vx).toBeGreaterThan(0); // right of center
      expect(particles[0].vy).toBeDefined();
    });
  });

  describe('shouldBeginDisperse', () => {
    it('never disperses if app is not yet ready (exiting: false)', () => {
      expect(
        shouldBeginDisperse({
          exiting: false,
          elapsed: 3000,
          now: 3000,
          assembleReadyAt: 1000,
        }),
      ).toBe(false);
    });

    it('does not disperse before minAssembleMs even if app is ready', () => {
      expect(
        shouldBeginDisperse({
          exiting: true,
          elapsed: 800,
          now: 800,
          assembleReadyAt: 500,
          minAssembleMs: 1200,
        }),
      ).toBe(false);
    });

    it('disperses once minAssembleMs is passed and assemble hold has elapsed', () => {
      expect(
        shouldBeginDisperse({
          exiting: true,
          elapsed: 1300,
          now: 1300,
          assembleReadyAt: 1100, // hold elapsed = 200ms >= bloomHoldMs (160ms)
          minAssembleMs: 1200,
          bloomHoldMs: 160,
        }),
      ).toBe(true);
    });

    it('disperses after soft threshold (1500ms) when app is ready even if assemble hold was not recorded', () => {
      expect(
        shouldBeginDisperse({
          exiting: true,
          elapsed: 1550,
          now: 1550,
          assembleReadyAt: 0, // not marked
          minAssembleMs: 1200,
        }),
      ).toBe(true);
    });

    it('always disperses at maxAssembleMs ceiling when app is ready (never hangs indefinitely)', () => {
      expect(
        shouldBeginDisperse({
          exiting: true,
          elapsed: 2300,
          now: 2300,
          assembleReadyAt: 0,
          maxAssembleMs: 2200,
        }),
      ).toBe(true);
    });
  });

  describe('Theme palette contract compatibility', () => {
    it('exports expected branding and neutral contrast colors', () => {
      expect(BRAND_ACCENT).toBe('rgb(22,119,255)');
      expect(BODY_COLOR_DARK).toBe('#ffffff');
      expect(BODY_COLOR_LIGHT).toBe('#141820');
    });
  });

  describe('ParticleBootScreen component lifecycle', () => {
    it('renders accessible status role container and loading indicator', () => {
      const { container } = render(
        React.createElement(ParticleBootScreen, {
          exiting: false,
          onExitComplete: () => {},
        }),
      );
      const statusElement = container.querySelector('[role="status"]');
      expect(statusElement).not.toBeNull();
      expect(statusElement?.getAttribute('aria-live')).toBe('polite');
    });

    it('renders static img and invokes onExitComplete when prefers-reduced-motion is true', async () => {
      const originalMatchMedia = window.matchMedia;
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        matches: query === '(prefers-reduced-motion: reduce)',
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));

      const onExitComplete = vi.fn();
      const { rerender, container } = render(
        React.createElement(ParticleBootScreen, {
          exiting: false,
          onExitComplete,
        }),
      );

      const staticImg = container.querySelector('img');
      expect(staticImg).not.toBeNull();
      expect(staticImg?.getAttribute('alt')).toBe('知远');

      rerender(
        React.createElement(ParticleBootScreen, {
          exiting: true,
          onExitComplete,
        }),
      );

      await waitFor(
        () => {
          expect(onExitComplete).toHaveBeenCalledTimes(1);
        },
        { timeout: 1000 },
      );

      window.matchMedia = originalMatchMedia;
    });
  });
});
