import { Button } from '@shared/components/ui/button';
import { X } from 'lucide-react';
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { i18nService } from '../../services/i18n';

export interface ImagePreviewSource {
  src: string;
  alt?: string | null;
  title?: string | null;
  name?: string | null;
}

interface ImagePreviewModalProps {
  image: ImagePreviewSource | null;
  onClose: () => void;
}

function getImageLabel(image: ImagePreviewSource): string {
  const label = image.name || image.title || image.alt;
  return label?.trim() || i18nService.t('artifactImageAlt');
}

const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({ image, onClose }) => {
  const mouseDownOnBackdropRef = useRef(false);

  useEffect(() => {
    if (!image) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [image, onClose]);

  if (!image) return null;

  const label = getImageLabel(image);

  const handleBackdropMouseDown: React.MouseEventHandler<HTMLDivElement> = event => {
    event.stopPropagation();
    mouseDownOnBackdropRef.current = event.target === event.currentTarget;
  };

  const handleBackdropClick: React.MouseEventHandler<HTMLDivElement> = event => {
    event.stopPropagation();
    if (event.target === event.currentTarget && mouseDownOnBackdropRef.current) {
      mouseDownOnBackdropRef.current = false;
      onClose();
    }
  };

  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={label}
      className="theme-surface-image-overlay fixed inset-0 z-10000 flex flex-col"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-end p-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="theme-page-image-preview-modal-button-1 pointer-events-auto"
          title={i18nService.t('close')}
          aria-label={i18nService.t('close')}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div
        className="flex min-h-0 flex-1 items-center justify-center px-5 py-16"
        onMouseDown={handleBackdropMouseDown}
        onClick={handleBackdropClick}
      >
        <div
          className="flex max-h-full max-w-full flex-col items-center gap-3"
          onMouseDown={event => event.stopPropagation()}
          onClick={event => event.stopPropagation()}
        >
          <div className="max-w-[min(90vw,720px)] truncate rounded-full bg-black/35 px-3 py-1 text-center text-xs font-medium text-white/85 ring-1 ring-white/10">
            {label}
          </div>
          <div className="flex max-h-full max-w-[75vw] items-center justify-center rounded-xl bg-white/95 p-1 shadow-2xl ring-1 ring-white/15">
            <img
              src={image.src}
              alt={image.alt ?? label}
              className="block max-h-[72vh] max-w-[min(75vw,960px)] object-contain rounded-lg"
              draggable={false}
            />
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === 'undefined') {
    return modal;
  }

  return createPortal(modal, document.body);
};

export default ImagePreviewModal;
