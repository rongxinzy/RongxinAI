import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFooterSurface,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { ArrowUpRight, Maximize2, Minimize2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { LocalizedPrompt } from '../../types/quickAction';
import { loadCasePreview } from './casePreviewSources';

interface CaseDetailDialogProps {
  prompt: LocalizedPrompt;
  capabilityLabel?: string;
  onClose: () => void;
  onUse: () => void;
}

export default function CaseDetailDialog({
  prompt,
  capabilityLabel,
  onClose,
  onUse,
}: CaseDetailDialogProps) {
  const { id, label, description, prompt: taskPrompt } = prompt;
  const [html, setHtml] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const applying = useRef(false);
  const t = (key: string) => i18nService.t(key);
  // The generated walkthrough pages embed copy, so a language switch has to rebuild them.
  // Subscribed instead of read once: the effect below has to re-run on its own, not because an
  // ancestor happened to re-render the tree.
  const [language, setLanguage] = useState(() => i18nService.getLanguage());

  useEffect(() => i18nService.subscribe(() => setLanguage(i18nService.getLanguage())), []);

  useEffect(() => {
    let cancelled = false;
    loadCasePreview(id, {
      label,
      description,
      prompt: taskPrompt,
      copy: {
        outlineKicker: i18nService.t('caseOutlineKicker'),
        deliverableKicker: i18nService.t('caseDeliverableKicker'),
        outlineFallback: i18nService.t('caseOutlineFallback'),
        deliverableTitle: i18nService.t('caseDeliverableTitle'),
        deliverableIntro: i18nService.t('caseDeliverableIntro'),
        deliverableItems: [
          i18nService.t('caseDeliverableStructure'),
          i18nService.t('caseDeliverableFile'),
          i18nService.t('caseDeliverableEditable'),
        ],
      },
    })
      .then(content => {
        if (!cancelled) setHtml(content);
      })
      .catch(() => {
        // The bundled thumbnail remains usable when loading the HTML fails.
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [description, id, label, language, taskPrompt]);

  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        finalFocus={() => !applying.current}
        className={`flex flex-col overflow-hidden ${expanded ? 'sm:max-w-[calc(100%-2rem)] h-[calc(100dvh-2rem)]' : 'sm:max-w-2xl h-[57dvh]'} max-h-[calc(100dvh-2rem)]`}
      >
        <DialogHeader className="shrink-0">
          <div className="flex items-start justify-between gap-4">
            <DialogTitle>{label}</DialogTitle>
            <DialogClose render={<Button variant="ghost" size="icon-sm" aria-label={t('close')} />}>
              <X />
            </DialogClose>
          </div>
          <DialogDescription>{description || t('caseExampleNotice')}</DialogDescription>
          {capabilityLabel && <Badge variant="secondary">{capabilityLabel}</Badge>}
        </DialogHeader>
        {/* The viewport reuses the gallery's thumbnail recipe on purpose: it holds the same
            artwork, so it keeps the muted backing and radius instead of adding a second hook. */}
        <div className="theme-page-case-gallery-media min-h-0 flex-1 overflow-auto">
          {html ? (
            <iframe
              className="block h-full w-full"
              srcDoc={html}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              title={label}
            />
          ) : prompt.preview ? (
            <img src={prompt.preview} alt={label} className="w-full" />
          ) : (
            <div className="flex flex-col gap-3">
              <span>{t('caseTaskDetails')}</span>
              <p className="whitespace-pre-wrap">{taskPrompt}</p>
            </div>
          )}
        </div>
        <DialogFooter surface={DialogFooterSurface.Seamless} className="shrink-0 items-center">
          <span className="sm:mr-auto" />
          <Button
            variant="outline"
            size="icon"
            aria-label={t(expanded ? 'codeBlockFullscreenExit' : 'codeBlockFullscreen')}
            onClick={() => setExpanded(value => !value)}
          >
            {expanded ? <Minimize2 /> : <Maximize2 />}
          </Button>
          <Button
            onClick={() => {
              applying.current = true;
              onClose();
              // Let the modal release its focus trap before focusing the composer.
              requestAnimationFrame(onUse);
            }}
          >
            {t('caseUseExample')}
            <ArrowUpRight />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
