const OWNED_HOSTS = ['rongxzyai.com', 'rongxzy.com', 'rongxinai.krli.org'];

export function isOwnedExternalUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.replace(/\.$/, '');
    return OWNED_HOSTS.some(domain => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}
