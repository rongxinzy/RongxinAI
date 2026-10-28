import { z } from 'zod';
import { WindowSensorFailure } from './constants';
import {
  WINDOW_SENSOR_MAX_DISPLAYS,
  WINDOW_SENSOR_MAX_SURFACES,
  WindowSensorMessage,
  WindowSurfaceSide,
} from '../../../shared/desktopPet/surfaces/constants';

const coordinate = z.number().finite().min(-2_000_000).max(2_000_000);
const point = z.object({ x: coordinate, y: coordinate }).strict();
const rect = point.extend({
  width: z.number().positive().max(100_000),
  height: z.number().positive().max(100_000),
});
const display = z
  .object({ id: z.string().min(1).max(40), dip: rect, physical: rect, workArea: rect })
  .strict();
export const windowSensorConfig = z
  .object({
    kind: z.literal(WindowSensorMessage.Configure),
    revision: z.number().int().positive(),
    displays: z.array(display).min(1).max(WINDOW_SENSOR_MAX_DISPLAYS),
    excluded: z.array(z.string().regex(/^[0-9a-f]{1,16}$/)).max(16),
  })
  .strict();
const sequence = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const windowSensorInput = z.discriminatedUnion('kind', [
  windowSensorConfig,
  z.object({ kind: z.literal(WindowSensorMessage.Ack), sequence }).strict(),
  z.object({ kind: z.literal(WindowSensorMessage.Stop) }).strict(),
]);
export const windowSensorSnapshot = z
  .object({
    kind: z.literal(WindowSensorMessage.Snapshot),
    sequence,
    revision: z.number().int().positive(),
    capturedAt: z.number().finite().positive(),
    timing: z
      .object({
        queueMs: z.number().nonnegative().max(60_000),
        runMs: z.number().nonnegative().max(60_000),
      })
      .strict(),
    surfaces: z
      .array(
        z
          .object({
            owner: z.string().regex(/^[0-9a-f]{1,16}$/),
            display: z.string().min(1).max(40),
            side: z.enum(WindowSurfaceSide),
            start: point,
            end: point,
            from: z.number().min(0).max(1),
            to: z.number().min(0).max(1),
          })
          .strict()
          .refine(
            edge =>
              edge.to > edge.from &&
              (edge.side === WindowSurfaceSide.Top
                ? edge.start.y === edge.end.y && edge.end.x > edge.start.x
                : edge.start.x === edge.end.x && edge.end.y > edge.start.y),
          ),
      )
      .max(WINDOW_SENSOR_MAX_SURFACES),
    fullscreenDisplays: z.array(z.string().min(1).max(40)).max(WINDOW_SENSOR_MAX_DISPLAYS),
  })
  .strict();

export const windowSensorError = z
  .object({
    kind: z.literal(WindowSensorMessage.Failed),
    code: z.enum(WindowSensorFailure),
  })
  .strict();
