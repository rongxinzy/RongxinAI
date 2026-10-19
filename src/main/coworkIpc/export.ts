/** Cowork export IPC: capture result image and session image export. */
import fs from 'fs';
import path from 'path';

import { app, dialog, BrowserWindow } from 'electron';

import { normalizeCaptureRect, savePngWithDialog } from './fileExportHelpers';
import { handleIpcContract } from '../ipc/handleIpcContract';
import { coworkExportContract } from '../../shared/ipc/coworkContract';
import type { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';

export interface CoworkExportIpcDeps {
  getPiRuntimeAdapter: () => PiRuntimeAdapter;
}

export const registerCoworkExportIpc = (deps: CoworkExportIpcDeps): void => {
  handleIpcContract(coworkExportContract, {
    exportResultImage: async (event, options) => {
      try {
        const sender = event.sender;
        const captureRect = normalizeCaptureRect(options.rect);
        if (!captureRect) {
          return { success: false as const, error: 'Capture rect is required' };
        }

        const image = await sender.capturePage(captureRect);
        return savePngWithDialog(sender, image.toPNG(), options.defaultFileName);
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to export session image',
        };
      }
    },

    captureImageChunk: async (event, options) => {
      try {
        const sender = event.sender;
        const captureRect = normalizeCaptureRect(options.rect);
        if (!captureRect) {
          return { success: false as const, error: 'Capture rect is required' };
        }

        const image = await sender.capturePage(captureRect);
        const pngBuffer = image.toPNG();

        return {
          success: true as const,
          width: captureRect.width,
          height: captureRect.height,
          pngBase64: pngBuffer.toString('base64'),
        };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to capture session image chunk',
        };
      }
    },

    saveResultImage: async (event, options) => {
      try {
        const sender = event.sender;
        const base64 = options.pngBase64.trim();
        if (!base64) {
          return { success: false as const, error: 'Image data is required' };
        }

        const pngBuffer = Buffer.from(base64, 'base64');
        if (pngBuffer.length <= 0) {
          return { success: false as const, error: 'Invalid image data' };
        }

        return savePngWithDialog(sender, pngBuffer, options.defaultFileName);
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to save session image',
        };
      }
    },

    exportSessionText: async (event, options) => {
      try {
        const content = options.content;
        if (!content) {
          return { success: false as const, error: 'Export content is empty' };
        }

        const ext = options.fileExtension || 'md';
        const filterName = ext === 'json' ? 'JSON' : 'Markdown';
        const defaultName = options.defaultFileName || `session-export.${ext}`;
        const ownerWindow = BrowserWindow.fromWebContents(event.sender);
        const saveOptions = {
          title: 'Export Session',
          defaultPath: path.join(app.getPath('downloads'), defaultName),
          filters: [{ name: filterName, extensions: [ext] }],
        };
        const saveResult = ownerWindow
          ? await dialog.showSaveDialog(ownerWindow, saveOptions)
          : await dialog.showSaveDialog(saveOptions);

        if (saveResult.canceled || !saveResult.filePath) {
          return { success: true as const, canceled: true };
        }

        await fs.promises.writeFile(saveResult.filePath, content, 'utf-8');
        return { success: true as const, canceled: false, path: saveResult.filePath };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to export session',
        };
      }
    },

    respondToPermission: async (_event, options) => {
      try {
        const runtime = deps.getPiRuntimeAdapter();
        runtime.respondToPermission(options.requestId, options.result);
        return { success: true as const };
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : 'Failed to respond to permission',
        };
      }
    },
  });
};
