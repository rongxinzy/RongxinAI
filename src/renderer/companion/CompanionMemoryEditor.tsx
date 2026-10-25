import { useId, useState } from 'react';
import { Button } from '@shared/components/ui/button';
import { DialogFooter, DialogFooterSurface } from '@shared/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import { Textarea } from '@shared/components/ui/textarea';
import { MemoryKind, type ManagedMemoryRecord } from '../../shared/memory';
import type { CompanionMemorySave } from '../../shared/companion/memory';
import { i18nService } from '../services/i18n';

export function CompanionMemoryEditor({
  record,
  busy,
  onCancel,
  onSave,
}: {
  record: ManagedMemoryRecord | null;
  busy: boolean;
  onCancel: () => void;
  onSave: (input: Omit<CompanionMemorySave, 'petId'>) => Promise<void>;
}) {
  const id = useId();
  const [title, setTitle] = useState(record?.title ?? '');
  const [content, setContent] = useState(record?.content ?? '');
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const t = (key: string) => i18nService.t(key);
  return (
    <form
      className="flex min-h-0 flex-col gap-4"
      onSubmit={event => {
        event.preventDefault();
        if (!busy && title.trim() && content.trim())
          void onSave({
            requestId,
            title: title.trim(),
            content: content.trim(),
            kind:
              record?.kind === MemoryKind.Decision ? MemoryKind.Decision : MemoryKind.Preference,
            replacesId: record?.id,
          });
      }}
    >
      <FieldGroup className="min-h-0 gap-4 overflow-y-auto">
        <Field>
          <FieldLabel htmlFor={`${id}-title`}>{t('companionMemoryTitle')}</FieldLabel>
          <Input
            id={`${id}-title`}
            value={title}
            maxLength={120}
            disabled={busy}
            autoFocus
            onChange={event => {
              setTitle(event.target.value);
              setRequestId(crypto.randomUUID());
            }}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor={`${id}-content`}>{t('companionMemoryContent')}</FieldLabel>
          <Textarea
            id={`${id}-content`}
            value={content}
            maxLength={3000}
            rows={5}
            autoGrow={false}
            disabled={busy}
            onChange={event => {
              setContent(event.target.value);
              setRequestId(crypto.randomUUID());
            }}
          />
        </Field>
      </FieldGroup>
      <DialogFooter surface={DialogFooterSurface.Seamless} className="shrink-0">
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit" disabled={busy || !title.trim() || !content.trim()}>
          {t('save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
