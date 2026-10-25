import { expect, test } from 'vitest';
import { fullscreenDisplays, surfacePoint, visibleWindowSurfaces } from './geometry';
import { WindowSurfaceSide } from './constants';
import type { NativeWindowFrame, SurfaceDisplay } from './types';

const display: SurfaceDisplay = {
  id: 'main',
  physical: { x: 0, y: 0, width: 1920, height: 1080 },
  dip: { x: 0, y: 0, width: 1920, height: 1080 },
  workArea: { x: 0, y: 0, width: 1920, height: 1040 },
};
const back: NativeWindowFrame = {
  id: 'back',
  rect: { x: 300, y: 400, width: 800, height: 500 },
  attachable: true,
};

test('only higher windows clip support, including non-attachable popups and body clearance', () => {
  const popup = {
    id: 'popup',
    rect: { x: 600, y: 250, width: 100, height: 200 },
    attachable: false,
  };
  const top = visibleWindowSurfaces([popup, back], [display]).filter(
    edge => edge.side === WindowSurfaceSide.Top,
  );
  expect(top).toHaveLength(2);
  expect(top.map(edge => [surfacePoint(edge, edge.from).x, surfacePoint(edge, edge.to).x])).toEqual(
    [
      [300, 502],
      [798, 1100],
    ],
  );
  expect(
    visibleWindowSurfaces([back, popup], [display]).filter(
      edge => edge.side === WindowSurfaceSide.Top,
    ),
  ).toHaveLength(1);
});

test('a fully covered owner never supplies an invisible ledge', () => {
  const cover = { id: 'cover', rect: { x: 0, y: 0, width: 1920, height: 1080 }, attachable: true };
  expect(
    visibleWindowSurfaces([cover, back], [display]).filter(edge => edge.owner === back.id),
  ).toEqual([]);
});

test('mixed DPI and negative coordinates map each physical edge through its own display', () => {
  const left = {
    id: 'left',
    physical: { x: -2560, y: 0, width: 2560, height: 1440 },
    dip: { x: -1280, y: 0, width: 1280, height: 720 },
    workArea: { x: -1280, y: 0, width: 1280, height: 700 },
  };
  const window = {
    id: 'spanning',
    rect: { x: -800, y: 500, width: 1600, height: 800 },
    attachable: true,
  };
  const top = visibleWindowSurfaces([window], [left, display]).filter(
    edge => edge.side === WindowSurfaceSide.Top,
  );
  expect(top).toHaveLength(2);
  expect(
    top.map(edge => [edge.display, surfacePoint(edge, edge.from), surfacePoint(edge, edge.to)]),
  ).toEqual([
    ['left', { x: -400, y: 250 }, { x: 0, y: 250 }],
    ['main', { x: 0, y: 500 }, { x: 800, y: 500 }],
  ]);
});

test('fullscreen uses foreground physical geometry and does not mistake maximized work area for it', () => {
  expect(fullscreenDisplays({ ...back, rect: display.workArea }, [display])).toEqual([]);
  expect(fullscreenDisplays({ ...back, rect: display.physical }, [display])).toEqual(['main']);
  expect(fullscreenDisplays(undefined, [display])).toEqual([]);
});
