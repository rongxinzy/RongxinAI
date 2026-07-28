/**
 * Public keys are intentionally versioned with the application. Release CI
 * replaces this map before packaging; private keys never enter this tree.
 * Values are base64-encoded DER SubjectPublicKeyInfo Ed25519 public keys.
 */
export const APP_UPDATE_TRUSTED_KEYS: Readonly<Record<string, string>> = {};
