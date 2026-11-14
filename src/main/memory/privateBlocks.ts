export function redactPrivateBlocks(value: string): string {
  return value.replace(/<private>[\s\S]*?<\/private>/gi, '[REDACTED]');
}
