import fs from 'fs';
import path from 'path';

export const PENDING_LOCAL_INFERENCE_INSTALL_FILE = 'pending-local-inference-install';

export function consumePendingLocalInferenceInstall(userDataPath: string): string | null {
  const markerPath = path.join(userDataPath, PENDING_LOCAL_INFERENCE_INSTALL_FILE);
  try {
    const requestId = fs.readFileSync(markerPath, 'utf8').trim();
    fs.rmSync(markerPath, { force: true });
    return requestId || 'installer-request';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn('[LocalInference] Failed to consume installer request:', error);
    }
    return null;
  }
}
