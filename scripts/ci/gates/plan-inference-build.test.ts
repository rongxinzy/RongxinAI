import { expect, test } from 'vitest';
import {
  InferenceBuildMode,
  classifyInferenceBuildPaths,
  resolveInferenceBuildMode,
} from './plan-inference-build.ts';
import { CiEvent } from './constants.ts';

test('classify full packaging paths', () => {
  expect(classifyInferenceBuildPaths(['electron-builder.json'])).toBe(InferenceBuildMode.Full);
  expect(classifyInferenceBuildPaths(['electron-builder.enterprise.cjs'])).toBe(
    InferenceBuildMode.Full,
  );
  expect(classifyInferenceBuildPaths(['vendor/llamacpp/bin/server'])).toBe(InferenceBuildMode.Full);
  expect(classifyInferenceBuildPaths(['.github/workflows/build-platforms.yml'])).toBe(
    InferenceBuildMode.Full,
  );
  expect(classifyInferenceBuildPaths(['scripts/release/inference-edition-targets.mjs'])).toBe(
    InferenceBuildMode.Full,
  );
  expect(classifyInferenceBuildPaths(['scripts/download-llamacpp.mjs'])).toBe(
    InferenceBuildMode.Full,
  );
});

test('classify packaging smoke paths without full triggers', () => {
  expect(classifyInferenceBuildPaths(['package.json'])).toBe(InferenceBuildMode.Smoke);
  expect(classifyInferenceBuildPaths(['bun.lock'])).toBe(InferenceBuildMode.Smoke);
  expect(classifyInferenceBuildPaths(['resources/magpie/upstream.json'])).toBe(
    InferenceBuildMode.Smoke,
  );
  expect(classifyInferenceBuildPaths(['scripts/ci/gates/plan.ts'])).toBe(InferenceBuildMode.Smoke);
});

test('full wins when packaging and smoke paths both change', () => {
  expect(classifyInferenceBuildPaths(['package.json', 'vendor/llamacpp/pinned-version.txt'])).toBe(
    InferenceBuildMode.Full,
  );
});

test('skip unrelated or empty diffs on pull requests', () => {
  expect(classifyInferenceBuildPaths([])).toBe(InferenceBuildMode.Skip);
  expect(classifyInferenceBuildPaths(['src/renderer/App.tsx'])).toBe(InferenceBuildMode.Skip);
});

test('schedule and manual dispatch always run the full matrix', () => {
  expect(resolveInferenceBuildMode('schedule', [])).toBe(InferenceBuildMode.Full);
  expect(resolveInferenceBuildMode(CiEvent.Manual, [])).toBe(InferenceBuildMode.Full);
});

test('non-PR events other than schedule/dispatch skip', () => {
  expect(resolveInferenceBuildMode(CiEvent.Push, ['package.json'])).toBe(InferenceBuildMode.Skip);
});
