/**
 * Canonical renderer-side resolution of artifact paths.
 *
 * The availability gate and the file readers must agree on which file a
 * declared path points at, so this module owns the only normaliser used for
 * renderer→main artifact reads. `file:` URLs are decoded the same way the main
 * process decoder (`node:url#fileURLToPath`) decodes them — percent escapes and
 * `#`/`?` fragments are URL syntax — while native paths are passed through
 * verbatim, so a real file name may keep literal `%` or `#` characters.
 */

/** Converts a `file:` URL into the native path the main process can stat. */
export function fileUrlToNativePath(rawUrl: string): string | null {
  if (!/^file:/i.test(rawUrl)) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'file:') return null;

  let decodedPath = url.pathname;
  try {
    decodedPath = decodeURIComponent(decodedPath);
  } catch {
    // Malformed escapes are kept verbatim so the probe fails visibly instead of
    // silently addressing a different file.
  }

  const host = url.hostname;
  // `file://host/share/x` addresses a UNC share; `localhost` is the local machine.
  if (host && host.toLowerCase() !== 'localhost') return `//${host}${decodedPath}`;
  // `file:///D:/x` keeps a leading slash that is not part of the drive path.
  if (/^\/[A-Za-z]:/.test(decodedPath)) return decodedPath.slice(1);
  return decodedPath;
}

/** Normalises a native path or `file:` URL into forward-slash native form. */
export function normalizeArtifactPath(rawPath: string): string {
  const filePath = (fileUrlToNativePath(rawPath) ?? rawPath).replace(/\\/g, '/');
  return /^\/[A-Za-z]:/.test(filePath) ? filePath.slice(1) : filePath;
}

/** Resolves an artifact path to an absolute native path, joining `cwd` for relative ones. */
export function resolveArtifactPath(rawPath: string, cwd?: string | null): string {
  const filePath = normalizeArtifactPath(rawPath);
  if (filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath)) return filePath;
  return `${cwd ?? ''}/${filePath}`.replace(/\\/g, '/');
}
