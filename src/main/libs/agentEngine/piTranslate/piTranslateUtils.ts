/**
 * Source: vercel/ai @ai-sdk/harness-pi@1.0.156
 * Path: packages/harness-pi/src/pi-utils.ts (serializeToolOutput)
 * License: Apache-2.0
 * Adapted: extracted only tool-output serialization used by pi-translate.
 */

/** Serialize a tool output to the string Pi feeds back to the model. */
export function serializeToolOutput(output: unknown): string {
  if (typeof output === 'string') {
    return output;
  }
  const serialized = JSON.stringify(output);
  return serialized ?? 'null';
}
