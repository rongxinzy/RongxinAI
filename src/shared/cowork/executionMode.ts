import { CoworkExecutionMode } from './constants';

export function parseCoworkExecutionMode(value: unknown): CoworkExecutionMode | undefined {
  if (value === undefined) return undefined;
  if (value === CoworkExecutionMode.Auto || value === CoworkExecutionMode.Local) return value;
  throw new Error('Unsupported execution mode');
}
