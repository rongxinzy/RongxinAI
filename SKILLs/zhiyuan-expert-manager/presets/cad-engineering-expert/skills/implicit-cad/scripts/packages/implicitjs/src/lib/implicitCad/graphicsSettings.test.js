import assert from "node:assert/strict";
import test from "node:test";

import {
  implicitGraphicsRenderResolutionScale,
  implicitGraphicsRenderSettings,
  normalizeImplicitGraphicsSettings
} from "./graphicsSettings.js";

test("implicit graphics render resolution uses idle or interaction scale", () => {
  const settings = normalizeImplicitGraphicsSettings({
    resolutionScale: 2.5,
    interactionResolutionScale: 0.75
  });

  assert.equal(implicitGraphicsRenderResolutionScale(settings), 2.5);
  assert.equal(implicitGraphicsRenderResolutionScale(settings, { interaction: true }), 0.75);
});

test("implicit graphics render settings reduce shader cost while interacting", () => {
  const settings = {
    resolutionScale: 2.5,
    interactionResolutionScale: 0.75,
    detail: 2,
    shadows: true,
    ambientOcclusion: true,
    rimLight: true
  };

  assert.deepEqual(implicitGraphicsRenderSettings(settings), {
    ...normalizeImplicitGraphicsSettings(settings)
  });
  assert.deepEqual(implicitGraphicsRenderSettings(settings, { interaction: true }), {
    ...normalizeImplicitGraphicsSettings(settings),
    detail: 0.75,
    stepBudget: 96,
    shadows: false,
    ambientOcclusion: false
  });
  assert.equal(
    implicitGraphicsRenderSettings({ ...settings, detail: 0.5, stepBudget: 24 }, { interaction: true }).stepBudget,
    24
  );
});
