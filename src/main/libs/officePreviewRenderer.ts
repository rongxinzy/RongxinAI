import { app, BrowserWindow, nativeImage } from 'electron';
import * as fs from 'fs';
import path from 'path';

import { ShortcutWorkflowKind } from './agentEngine/piShortcutWorkflowPolicy';

const PreviewWidth = 1280;
const PreviewHeight = 1600;
const MaxPreviewWidth = 1600;
const MaxPreviewHeight = 2400;

interface RenderBounds {
  width: number;
  height: number;
}

export const isRasterPreviewDecodable = (filePath: string): boolean => {
  try {
    const image = nativeImage.createFromPath(filePath);
    const size = image.getSize();
    return !image.isEmpty() && size.width > 0 && size.height > 0 && image.toPNG().length > 0;
  } catch {
    return false;
  }
};

const loadPreviewPage = async (window: BrowserWindow): Promise<void> => {
  const developmentUrl = process.env.ELECTRON_START_URL;
  if (!app.isPackaged && developmentUrl) {
    await window.loadURL(`${developmentUrl.replace(/\/$/, '')}/office-preview.html`);
    return;
  }
  await window.loadFile(path.join(__dirname, '../dist/office-preview.html'));
};

export const renderOfficePreview = async (
  deliverablePath: string,
  outputPath: string,
  kind: ShortcutWorkflowKind,
): Promise<void> => {
  if (kind !== ShortcutWorkflowKind.Docs && kind !== ShortcutWorkflowKind.Sheets) {
    throw new Error('The built-in Office renderer supports only DOCX and spreadsheet files.');
  }
  const data = fs.readFileSync(deliverablePath);
  if (data.length === 0) throw new Error('The Office deliverable is empty.');

  const window = new BrowserWindow({
    show: false,
    width: PreviewWidth,
    height: PreviewHeight,
    backgroundColor: '#e8ebef',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      backgroundThrottling: false,
      devTools: false,
    },
  });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());

  try {
    await loadPreviewPage(window);
    const request = {
      kind,
      fileName: path.basename(deliverablePath),
      dataBase64: data.toString('base64'),
    };
    const bounds = (await window.webContents.executeJavaScript(
      `window.zhiyuanRenderOfficePreview(${JSON.stringify(request)})`,
      true,
    )) as RenderBounds;
    const width = Math.max(320, Math.min(MaxPreviewWidth, Math.ceil(bounds.width)));
    const height = Math.max(240, Math.min(MaxPreviewHeight, Math.ceil(bounds.height)));
    window.setContentSize(width, height);
    await window.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      true,
    );
    const image = await window.webContents.capturePage({ x: 0, y: 0, width, height });
    if (image.isEmpty()) throw new Error('The bundled renderer produced an empty image.');
    const png = image.toPNG();
    if (png.length === 0) throw new Error('The bundled renderer produced no PNG bytes.');
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, png);
    if (!isRasterPreviewDecodable(outputPath)) {
      throw new Error('The bundled renderer produced an undecodable PNG.');
    }
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
};
