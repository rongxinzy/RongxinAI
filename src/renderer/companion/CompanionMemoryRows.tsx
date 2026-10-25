import { Fragment } from 'react';
import { Pencil, Share2, Trash2 } from 'lucide-react';
import { Button } from '@shared/components/ui/button';
import { Field, FieldContent, FieldDescription, FieldTitle } from '@shared/components/ui/field';
import { Separator } from '@shared/components/ui/separator';
import type { ManagedMemoryRecord } from '../../shared/memory';
import { companionMemoryNeedsReview } from '../../shared/companion/memoryStatus';
import { i18nService } from '../services/i18n';

export function CompanionMemoryRows({
  records,
  busy,
  edit,
  share,
  review,
  forget,
}: {
  records: ManagedMemoryRecord[];
  busy: boolean;
  edit: (record: ManagedMemoryRecord) => void;
  share: (record: ManagedMemoryRecord) => void;
  review: (record: ManagedMemoryRecord) => void;
  forget: (record: ManagedMemoryRecord) => void;
}) {
  const t = (key: string) => i18nService.t(key);
  return (
    <div className="flex flex-col gap-4">
      {records.map((record, index) => (
        <Fragment key={record.id}>
          {index ? <Separator /> : null}
          <Field orientation="horizontal" className="items-start">
            <FieldContent className="min-w-0">
              <FieldTitle className="break-words">{record.title}</FieldTitle>
              <FieldDescription className="whitespace-pre-wrap break-words">
                {record.content}
              </FieldDescription>
              {record.memoryId === null ? (
                <FieldDescription>
                  {t(
                    companionMemoryNeedsReview(record)
                      ? 'companionMemoryNeedsReview'
                      : 'companionMemoryPending',
                  )}
                </FieldDescription>
              ) : null}
            </FieldContent>
            <div className="flex shrink-0 items-center gap-1">
              {companionMemoryNeedsReview(record) ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`${t('companionMemoryReview')}: ${record.title}`}
                  disabled={busy}
                  onClick={() => review(record)}
                >
                  {t('companionMemoryReview')}
                </Button>
              ) : (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${t('companionMemoryEdit')}: ${record.title}`}
                    disabled={busy || record.memoryId === null}
                    onClick={() => edit(record)}
                  >
                    <Pencil strokeWidth={1.75} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${t('companionMemoryShare')}: ${record.title}`}
                    disabled={busy || record.memoryId === null}
                    onClick={() => share(record)}
                  >
                    <Share2 strokeWidth={1.75} />
                  </Button>
                </>
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${t('delete')}: ${record.title}`}
                disabled={busy}
                onClick={() => forget(record)}
              >
                <Trash2 strokeWidth={1.75} />
              </Button>
            </div>
          </Field>
        </Fragment>
      ))}
    </div>
  );
}
