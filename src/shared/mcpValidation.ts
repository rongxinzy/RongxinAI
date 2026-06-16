export type McpTransportType = 'stdio' | 'sse' | 'http';

const URL_HOST_LABEL_PATTERN = /^[a-z0-9-]{1,63}$/i;
const IPV4_PATTERN = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isValidIpv4Hostname(hostname: string): boolean {
  return IPV4_PATTERN.test(hostname);
}

function isValidDomainHostname(hostname: string): boolean {
  if (!hostname || hostname.length > 253) {
    return false;
  }

  const normalized = hostname.toLowerCase();
  if (normalized.startsWith('.') || normalized.endsWith('.')) {
    return false;
  }
  if (normalized.includes('..')) {
    return false;
  }

  const labels = normalized.split('.');
  return labels.every((label) => {
    if (!URL_HOST_LABEL_PATTERN.test(label)) {
      return false;
    }
    return !label.startsWith('-') && !label.endsWith('-');
  });
}

function isValidUrlHostname(hostname: string): boolean {
  if (!hostname) {
    return false;
  }

  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (normalized === 'localhost') {
    return true;
  }

  if (normalized.includes(':')) {
    return true;
  }

  if (isValidIpv4Hostname(normalized)) {
    return true;
  }

  return isValidDomainHostname(normalized);
}

export function isValidMcpCommandFormat(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed) {
    return false;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return false;
  }

  if (/^[0-9]+$/.test(trimmed)) {
    return false;
  }

  if (/\s/.test(trimmed) && !(/[\\/]/.test(trimmed) || /^[A-Za-z]:/.test(trimmed))) {
    return false;
  }

  return /^[A-Za-z0-9._\-/:\\]+$/.test(trimmed);
}

export function isValidMcpUrlFormat(rawUrl: string): boolean {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return false;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  return isValidUrlHostname(parsed.hostname);
}

export function validateMcpTransportFields(
  transportType: McpTransportType,
  data: { command?: string; url?: string },
): 'mcpCommandRequired' | 'mcpCommandInvalid' | 'mcpUrlRequired' | 'mcpUrlInvalid' | null {
  if (transportType === 'stdio') {
    if (!data.command?.trim()) {
      return 'mcpCommandRequired';
    }
    if (!isValidMcpCommandFormat(data.command)) {
      return 'mcpCommandInvalid';
    }
    return null;
  }

  if (!data.url?.trim()) {
    return 'mcpUrlRequired';
  }

  if (!isValidMcpUrlFormat(data.url)) {
    return 'mcpUrlInvalid';
  }

  return null;
}
