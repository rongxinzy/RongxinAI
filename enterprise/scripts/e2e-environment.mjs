export function requiredEnvironment(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required for this real-service E2E verifier.`);
  }
  return value;
}
