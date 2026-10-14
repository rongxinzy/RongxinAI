/**
 * Locates the bundled image-text extraction helper (see resources/ocr).
 *
 * Cowork withholds images from models that cannot read them, so the agent is
 * pointed at this script instead of being left to hand-roll a WinRT PowerShell
 * incantation. The helper is resolved from the packaged resources directory or
 * from the repository root in development, and is only advertised when the file
 * actually exists — a path the model cannot run would be worse than no path.
 */

import fs from 'fs';
import path from 'path';

const OCR_SCRIPT_SEGMENTS = ['ocr', 'ocr-image.ps1'];

export interface BundledOcrHelper {
  /** Absolute path of the bundled script. */
  scriptPath: string;
  /** Ready-to-run command for one image, quoted for copy/paste into bash. */
  commandFor: (imagePath: string) => string;
}

/** Candidate locations, most specific first: packaged, then dev checkouts. */
export function resolveBundledOcrScriptCandidates(): string[] {
  const candidates: string[] = [];
  const packagedRoot = process.resourcesPath;
  if (typeof packagedRoot === 'string' && packagedRoot.length > 0) {
    candidates.push(path.join(packagedRoot, ...OCR_SCRIPT_SEGMENTS));
  }
  // dist-electron/libs/main.js -> repository root.
  candidates.push(path.join(__dirname, '..', '..', 'resources', ...OCR_SCRIPT_SEGMENTS));
  candidates.push(path.join(process.cwd(), 'resources', ...OCR_SCRIPT_SEGMENTS));
  return candidates;
}

/**
 * Returns the helper when this platform and build can run it, otherwise null
 * (the caller then falls back to asking the user for the text).
 */
export function resolveBundledOcrHelper(): BundledOcrHelper | null {
  // The script depends on Windows.Media.Ocr; other platforms have no equivalent
  // bundled path, so do not advertise one.
  if (process.platform !== 'win32') return null;

  const scriptPath = resolveBundledOcrScriptCandidates().find(candidate => {
    try {
      return fs.existsSync(candidate);
    } catch {
      return false;
    }
  });
  if (!scriptPath) return null;

  return {
    scriptPath,
    commandFor: (imagePath: string) =>
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -Path "${imagePath}"`,
  };
}
