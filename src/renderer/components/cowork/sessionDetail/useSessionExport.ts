import React, { useCallback, useEffect, useState } from 'react';

import { coworkService } from '../../../services/cowork';
import { i18nService } from '../../../services/i18n';
import type { CoworkSession } from '../../../types/cowork';
import { type CoworkOpenShareOptionsEventDetail, CoworkUiEvent } from '../constants';
import type { CaptureRect } from '../helpers/exportUtils';
import {
  composeExportCanvas,
  domRectToCaptureRect,
  formatExportTimestamp,
  loadImageFromBase64,
  MAX_EXPORT_CANVAS_HEIGHT,
  MAX_EXPORT_SEGMENTS,
  sanitizeExportFileName,
  waitForNextFrame,
} from '../helpers/exportUtils';
import { sessionToJSON, sessionToMarkdown } from './sessionExport';

interface UseSessionExportOptions {
  currentSession: CoworkSession | null;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
}

export interface SessionExportController {
  isExportingImage: boolean;
  showExportOptions: boolean;
  setShowExportOptions: (open: boolean) => void;
  handleExportText: (format: 'md' | 'json') => Promise<void>;
  handleShareClick: (e: React.MouseEvent) => void;
}

/**
 * Session export state machine: the share-options dialog visibility, the
 * Markdown/JSON text export and the stitched long-screenshot image export.
 */
export const useSessionExport = ({
  currentSession,
  scrollContainerRef,
}: UseSessionExportOptions): SessionExportController => {
  const [isExportingImage, setIsExportingImage] = useState(false);
  const [showExportOptions, setShowExportOptions] = useState(false);

  useEffect(() => {
    const handleOpenShareOptions = (event: Event) => {
      const detail = (event as CustomEvent<CoworkOpenShareOptionsEventDetail>).detail;
      if (!detail?.sessionId || detail.sessionId !== currentSession?.id) return;
      setShowExportOptions(true);
    };

    window.addEventListener(CoworkUiEvent.OpenShareOptions, handleOpenShareOptions);
    return () => {
      window.removeEventListener(CoworkUiEvent.OpenShareOptions, handleOpenShareOptions);
    };
  }, [currentSession?.id]);

  const handleExportText = useCallback(
    async (format: 'md' | 'json') => {
      if (!currentSession) return;
      const content =
        format === 'md' ? sessionToMarkdown(currentSession) : sessionToJSON(currentSession);
      const timestamp = new Date().toISOString().slice(0, 10);
      const fileName = sanitizeExportFileName(`${currentSession.title}-${timestamp}.${format}`);
      try {
        const result = await window.electron.cowork.exportSessionText({
          content,
          defaultFileName: fileName,
          fileExtension: format,
        });
        if (result.success && !result.canceled) {
          window.dispatchEvent(
            new CustomEvent('app:showToast', {
              detail: i18nService.t('coworkExportTextSuccess'),
            }),
          );
        } else if (!result.success) {
          throw new Error(result.error || 'Export failed');
        }
      } catch (error) {
        console.error('Failed to export session text:', error);
        window.dispatchEvent(
          new CustomEvent('app:showToast', {
            detail: i18nService.t('coworkExportTextFailed'),
          }),
        );
      }
    },
    [currentSession],
  );

  const handleShareClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!currentSession || isExportingImage) return;
      setIsExportingImage(true);

      window.requestAnimationFrame(() => {
        void (async () => {
          try {
            const scrollContainer = scrollContainerRef.current;
            if (!scrollContainer) {
              throw new Error('Capture target not found');
            }
            // Wait for React to commit `renderAll` / `forceExpanded` and for lazy
            // subtrees to settle their DOM height before measuring anchors.
            await waitForNextFrame();
            let previousHeight = -1;
            let previousAnchorCount = -1;
            for (let frame = 0; frame < 6; frame += 1) {
              await waitForNextFrame();
              const currentHeight = scrollContainer.scrollHeight;
              const currentAnchorCount = scrollContainer.querySelectorAll(
                '[data-export-role="user-message"], [data-export-role="assistant-block"]',
              ).length;
              if (
                currentHeight === previousHeight &&
                currentAnchorCount === previousAnchorCount &&
                currentHeight > 0
              ) {
                break;
              }
              previousHeight = currentHeight;
              previousAnchorCount = currentAnchorCount;
            }
            const initialScrollTop = scrollContainer.scrollTop;
            try {
              const scrollRect = domRectToCaptureRect(scrollContainer.getBoundingClientRect());
              if (scrollRect.width <= 0 || scrollRect.height <= 0) {
                throw new Error('Invalid capture area');
              }

              const scrollContentHeight = Math.max(
                scrollContainer.scrollHeight,
                scrollContainer.clientHeight,
              );
              if (scrollContentHeight <= 0) {
                throw new Error('Invalid content height');
              }

              const toContentY = (viewportY: number): number => {
                const y = scrollContainer.scrollTop + (viewportY - scrollRect.y);
                return Math.max(0, Math.min(scrollContentHeight, y));
              };

              const userAnchors = scrollContainer.querySelectorAll<HTMLElement>(
                '[data-export-role="user-message"]',
              );
              const assistantAnchors = scrollContainer.querySelectorAll<HTMLElement>(
                '[data-export-role="assistant-block"]',
              );

              let contentStart = 0;
              let contentEnd = scrollContentHeight;

              if (userAnchors.length > 0) {
                contentStart = toContentY(userAnchors[0].getBoundingClientRect().top);
              } else if (assistantAnchors.length > 0) {
                contentStart = toContentY(assistantAnchors[0].getBoundingClientRect().top);
              }

              if (assistantAnchors.length > 0) {
                const lastAssistant = assistantAnchors[assistantAnchors.length - 1];
                contentEnd = toContentY(lastAssistant.getBoundingClientRect().bottom);
              } else if (userAnchors.length > 0) {
                const lastUser = userAnchors[userAnchors.length - 1];
                contentEnd = toContentY(lastUser.getBoundingClientRect().bottom);
              }

              const maxStart = Math.max(0, scrollContentHeight - 1);
              contentStart = Math.max(0, Math.min(maxStart, Math.round(contentStart)));
              contentEnd = Math.max(
                contentStart + 1,
                Math.min(scrollContentHeight, Math.round(contentEnd)),
              );

              const outputHeight = contentEnd - contentStart;

              if (outputHeight > MAX_EXPORT_CANVAS_HEIGHT) {
                throw new Error(`Export image is too tall (${outputHeight}px)`);
              }

              const segmentsEstimate = Math.ceil(outputHeight / Math.max(1, scrollRect.height)) + 1;
              if (segmentsEstimate > MAX_EXPORT_SEGMENTS) {
                throw new Error('Export image is too long');
              }

              const canvas = document.createElement('canvas');
              canvas.width = scrollRect.width;
              canvas.height = outputHeight;
              const context = canvas.getContext('2d');
              if (!context) {
                throw new Error('Canvas context unavailable');
              }

              const captureAndLoad = async (rect: CaptureRect): Promise<HTMLImageElement> => {
                const chunk = await coworkService.captureSessionImageChunk({ rect });
                if (!chunk.success || !chunk.pngBase64) {
                  throw new Error(chunk.error || 'Failed to capture image chunk');
                }
                return loadImageFromBase64(chunk.pngBase64);
              };

              scrollContainer.scrollTop = Math.min(
                contentStart,
                Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight),
              );
              await waitForNextFrame();
              await waitForNextFrame();

              const maxScrollTop = Math.max(
                0,
                scrollContainer.scrollHeight - scrollContainer.clientHeight,
              );
              let contentOffset = contentStart;
              while (contentOffset < contentEnd) {
                const targetScrollTop = Math.min(contentOffset, maxScrollTop);
                scrollContainer.scrollTop = targetScrollTop;
                await waitForNextFrame();
                await waitForNextFrame();

                const chunkImage = await captureAndLoad(scrollRect);
                const sourceYOffset = Math.max(0, contentOffset - targetScrollTop);
                const drawableHeight = Math.min(
                  scrollRect.height - sourceYOffset,
                  contentEnd - contentOffset,
                );
                if (drawableHeight <= 0) {
                  throw new Error('Failed to stitch export image');
                }
                const scaleY = chunkImage.naturalHeight / scrollRect.height;
                const sourceYInImage = Math.max(0, Math.round(sourceYOffset * scaleY));
                const sourceHeightInImage = Math.max(
                  1,
                  Math.min(
                    chunkImage.naturalHeight - sourceYInImage,
                    Math.round(drawableHeight * scaleY),
                  ),
                );

                context.drawImage(
                  chunkImage,
                  0,
                  sourceYInImage,
                  chunkImage.naturalWidth,
                  sourceHeightInImage,
                  0,
                  contentOffset - contentStart,
                  scrollRect.width,
                  drawableHeight,
                );

                contentOffset += drawableHeight;
              }

              // Compose final canvas with branded header and footer
              const finalCanvas = await composeExportCanvas(
                canvas,
                currentSession.title,
                currentSession.createdAt,
              );

              const pngDataUrl = finalCanvas.toDataURL('image/png');
              const base64Index = pngDataUrl.indexOf(',');
              if (base64Index < 0) {
                throw new Error('Failed to encode export image');
              }

              const timestamp = formatExportTimestamp(new Date());
              const saveResult = await coworkService.saveSessionResultImage({
                pngBase64: pngDataUrl.slice(base64Index + 1),
                defaultFileName: sanitizeExportFileName(`${currentSession.title}-${timestamp}.png`),
              });
              if (saveResult.success && !saveResult.canceled) {
                window.dispatchEvent(
                  new CustomEvent('app:showToast', {
                    detail: i18nService.t('coworkExportImageSuccess'),
                  }),
                );
                return;
              }
              if (!saveResult.success) {
                throw new Error(saveResult.error || 'Failed to export image');
              }
            } finally {
              scrollContainer.scrollTop = initialScrollTop;
            }
          } catch (error) {
            console.error('Failed to export session image:', error);
            window.dispatchEvent(
              new CustomEvent('app:showToast', {
                detail: i18nService.t('coworkExportImageFailed'),
              }),
            );
          } finally {
            setIsExportingImage(false);
          }
        })();
      });
    },
    [currentSession, isExportingImage, scrollContainerRef],
  );

  return {
    isExportingImage,
    showExportOptions,
    setShowExportOptions,
    handleExportText,
    handleShareClick,
  };
};
