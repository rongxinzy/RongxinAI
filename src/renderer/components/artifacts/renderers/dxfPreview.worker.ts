import { dxfPreviewToSvg, parseDxfPreview } from './dxfPreview';

export interface DxfPreviewWorkerRequest {
  text: string;
}

export interface DxfPreviewWorkerResponse {
  svg: string | null;
}

self.onmessage = (event: MessageEvent<DxfPreviewWorkerRequest>) => {
  const { text } = event.data;
  try {
    const model = parseDxfPreview(text);
    const svg = dxfPreviewToSvg(model);
    self.postMessage({ svg } satisfies DxfPreviewWorkerResponse);
  } catch {
    self.postMessage({ svg: null } satisfies DxfPreviewWorkerResponse);
  }
};
