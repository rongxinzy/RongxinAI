import { useRef, useState } from 'react';
import { Brain, Plus } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogFooterSurface,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { FieldDescription, FieldError, FieldTitle } from '@shared/components/ui/field';
import type { CompanionWindowApi } from '../../shared/companion/types';
import type { ManagedMemoryRecord } from '../../shared/memory';
import { i18nService } from '../services/i18n';
import { CompanionMemoryEditor } from './CompanionMemoryEditor';
import { CompanionMemoryRows } from './CompanionMemoryRows';
import { useCompanionMemory } from './useCompanionMemory';

export function CompanionMemoryDialog({
  api,
  petId,
  name,
}: {
  api?: CompanionWindowApi;
  petId: string;
  name: string;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<{ record: ManagedMemoryRecord | null } | null>(null);
  const [sharing, setSharing] = useState<{ record: ManagedMemoryRecord; requestId: string } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<ManagedMemoryRecord | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const memory = useCompanionMemory(api, petId, open);
  const t = (key: string) => i18nService.t(key);
  const title = editing
    ? t(editing.record ? 'companionMemoryEdit' : 'companionMemoryAdd')
    : sharing
      ? t('companionMemoryShare')
      : t('companionMemoryOwner').replace('{name}', name);
  const close = () => {
    if (!memory.busy) {
      setOpen(false);
      setEditing(null);
      setSharing(null);
    }
  };
  return (
    <>
      <Button
        ref={trigger}
        variant="ghost"
        size="default"
        aria-label={t('companionMemory')}
        onClick={() => {
          memory.setNotice(null);
          setOpen(true);
        }}
      >
        <Brain strokeWidth={1.75} />
        {t('companionMemory')}
      </Button>
      <Dialog
        open={open && !deleting}
        onOpenChange={next => {
          if (!next) close();
        }}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] sm:max-w-lg"
          finalFocus={deleting ? false : trigger}
          showCloseButton={!memory.busy}
          closeLabel={t('close')}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>
              {t(sharing ? 'companionMemoryShareDescription' : 'companionMemoryPrivate')}
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-4">
            {memory.error ? <FieldError>{t(memory.error)}</FieldError> : null}
            {memory.notice ? (
              <FieldDescription role="status">{t(memory.notice)}</FieldDescription>
            ) : null}
            {editing ? (
              <CompanionMemoryEditor
                record={editing.record}
                busy={memory.busy}
                onCancel={() => setEditing(null)}
                onSave={async input => {
                  const saved = await memory.run(async () => {
                    const record = await api!.saveMemory({ ...input, petId });
                    if (record.memoryId === null) memory.setNotice('companionMemoryPending');
                  });
                  if (saved) setEditing(null);
                }}
              />
            ) : sharing ? (
              <>
                <div
                  role="region"
                  aria-label={t('companionMemoryContent')}
                  tabIndex={0}
                  className="theme-scroll-viewport flex min-h-0 min-w-0 flex-col gap-2 overflow-y-auto"
                >
                  <FieldTitle className="break-words">{sharing.record.title}</FieldTitle>
                  <FieldDescription className="whitespace-pre-wrap break-words">
                    {sharing.record.content}
                  </FieldDescription>
                </div>
                <DialogFooter surface={DialogFooterSurface.Seamless} className="shrink-0">
                  <Button variant="ghost" disabled={memory.busy} onClick={() => setSharing(null)}>
                    {t('cancel')}
                  </Button>
                  <Button
                    disabled={memory.busy}
                    onClick={() =>
                      void memory
                        .run(async () => {
                          const result = await api!.shareMemory({
                            petId,
                            id: sharing.record.id,
                            requestId: sharing.requestId,
                            confirmed: true,
                          });
                          memory.setNotice(
                            result.available ? 'companionMemoryShared' : 'companionMemoryPending',
                          );
                        })
                        .then(saved => {
                          if (saved) setSharing(null);
                        })
                    }
                  >
                    {t('companionMemoryShareConfirm')}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <div className="min-h-0 overflow-y-auto">
                  {memory.loading ? (
                    <FieldDescription role="status">{t('companionMemoryLoading')}</FieldDescription>
                  ) : memory.records.length ? (
                    <CompanionMemoryRows
                      records={memory.records}
                      busy={memory.busy}
                      edit={record => {
                        memory.setNotice(null);
                        setEditing({ record });
                      }}
                      share={record => {
                        memory.setNotice(null);
                        setSharing({ record, requestId: crypto.randomUUID() });
                      }}
                      forget={setDeleting}
                    />
                  ) : !memory.error ? (
                    <FieldDescription>{t('companionMemoryEmpty')}</FieldDescription>
                  ) : null}
                </div>
                <DialogFooter surface={DialogFooterSurface.Seamless} className="shrink-0">
                  <Button
                    variant="ghost"
                    disabled={memory.busy || memory.loading}
                    onClick={() => void memory.reload()}
                  >
                    {t('companionRefresh')}
                  </Button>
                  <Button
                    disabled={memory.busy}
                    onClick={() => {
                      memory.setNotice(null);
                      setEditing({ record: null });
                    }}
                  >
                    <Plus strokeWidth={1.75} />
                    {t('companionMemoryAdd')}
                  </Button>
                </DialogFooter>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <DestructiveConfirmDialog
        open={Boolean(deleting)}
        title={t('companionMemoryDelete')}
        description={t('companionMemoryDeleteDescription')}
        cancelLabel={t('cancel')}
        confirmLabel={t('delete')}
        isConfirming={memory.busy}
        onCancel={() => {
          if (!memory.busy) setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting)
            void memory
              .run(async () => {
                await api!.forgetMemory(petId, deleting.id);
              })
              .then(() => setDeleting(null));
        }}
      />
    </>
  );
}
