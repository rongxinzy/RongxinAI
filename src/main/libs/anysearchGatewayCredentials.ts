/**
 * Product-scoped gateway credential for the built-in Agent search capability.
 *
 * This is deliberately lightweight obfuscation, not cryptographic protection:
 * it prevents accidental copy/paste from source while keeping startup cost near
 * zero. The gateway still enforces authentication and the token can be rotated
 * by replacing this representation in a normal release.
 */
const mask = new Uint8Array([73, 31, 184, 44, 209, 7, 102, 158, 58, 241, 19, 84, 166, 12, 227, 91]);
const encoded = new Uint8Array([64, 36, 44, 74, 108, 86, 53, 135, 61, 194, 194, 34, 238, 145, 94, 243, 67, 105, 87, 2, 48, 8, 83, 134, 54, 225, 146, 15, 243, 145, 100, 149, 68, 121, 121, 76, 104, 30, 79, 136, 12, 140, 134]);

export function resolveAnySearchGatewayToken(): string {
  const deploymentOverride = process.env.ZHIYUAN_ANYSEARCH_GATEWAY_TOKEN?.trim();
  if (deploymentOverride) return deploymentOverride;

  const clear = encoded.map((value, index) => value ^ mask[(index * 7 + 3) % mask.length]);
  return new TextDecoder().decode(clear);
}

export function resolveAnySearchGatewayUrl(): string {
  return process.env.ZHIYUAN_ANYSEARCH_GATEWAY_URL?.trim() || 'https://search.rongxzyai.com';
}
