import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Field, FieldGroup, FieldLabel } from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Spinner } from '@shared/components/ui/spinner';
import { Textarea } from '@shared/components/ui/textarea';
import {
  MemoryKind,
  MemoryScope,
  MemorySensitivity,
  type ManagedMemoryRecord,
  type ManualMemoryScope,
} from '../../../../shared/memory';
import { i18nService } from '../../../services/i18n';
export interface MemoryDraft {
  scope: ManualMemoryScope;
  title: string;
  content: string;
  kind: typeof MemoryKind.Decision | typeof MemoryKind.Preference;
  sensitivity: typeof MemorySensitivity.Normal | typeof MemorySensitivity.Sensitive;
}

export interface MemoryEditor {
  record: ManagedMemoryRecord | null;
  draft: MemoryDraft;
}

export const emptyDraft = (): MemoryDraft => ({
  scope: MemoryScope.Personal,
  title: '',
  content: '',
  kind: MemoryKind.Preference,
  sensitivity: MemorySensitivity.Normal,
});

export function MemoryEditorDialog(props: {
  editor: MemoryEditor | null;
  busy: boolean;
  onClose: () => void;
  onChange: (patch: Partial<MemoryDraft>) => void;
  onSave: () => void;
}) {
  const { editor, busy, onClose, onChange, onSave } = props;
  const draft = editor?.draft ?? emptyDraft();
  const valid = Boolean(draft.title.trim() && draft.content.trim());
  return (
    <Dialog open={editor !== null} onOpenChange={open => !open && onClose()}>
      <DialogContent
        closeLabel={i18nService.t('close')}
        className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col overflow-hidden sm:max-w-lg"
      >
        <DialogHeader className="shrink-0">
          <DialogTitle>
            {editor?.record
              ? i18nService.t('managedMemoryEditTitle')
              : i18nService.t('managedMemoryCreateTitle')}
          </DialogTitle>
          <DialogDescription>{i18nService.t('managedMemoryEditorDescription')}</DialogDescription>
        </DialogHeader>
        <FieldGroup className="min-h-0 flex-1 gap-4 overflow-y-auto">
          <Field data-disabled={Boolean(editor?.record) || undefined}>
            <FieldLabel htmlFor="managed-memory-scope">
              {i18nService.t('managedMemoryFieldScope')}
            </FieldLabel>
            <Select
              value={draft.scope}
              onValueChange={value => onChange({ scope: value as ManualMemoryScope })}
              disabled={Boolean(editor?.record)}
            >
              <SelectTrigger id="managed-memory-scope" className="w-full">
                <SelectValue>{scopeLabel(draft.scope)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value={MemoryScope.Personal}>
                    {i18nService.t('managedMemoryScopePersonal')}
                  </SelectItem>
                  <SelectItem value={MemoryScope.Project}>
                    {i18nService.t('managedMemoryScopeProject')}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="managed-memory-title">
              {i18nService.t('managedMemoryFieldTitle')}
            </FieldLabel>
            <Input
              id="managed-memory-title"
              value={draft.title}
              onChange={event => onChange({ title: event.target.value })}
              placeholder={i18nService.t('managedMemoryTitlePlaceholder')}
              autoFocus
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="managed-memory-content">
              {i18nService.t('managedMemoryFieldContent')}
            </FieldLabel>
            <Textarea
              id="managed-memory-content"
              autoGrow={false}
              rows={5}
              value={draft.content}
              onChange={event => onChange({ content: event.target.value })}
              placeholder={i18nService.t('managedMemoryContentPlaceholder')}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field>
              <FieldLabel htmlFor="managed-memory-kind">
                {i18nService.t('managedMemoryFieldKind')}
              </FieldLabel>
              <Select
                value={draft.kind}
                onValueChange={value =>
                  onChange({
                    kind:
                      value === MemoryKind.Decision ? MemoryKind.Decision : MemoryKind.Preference,
                  })
                }
              >
                <SelectTrigger id="managed-memory-kind" className="w-full">
                  <SelectValue>
                    {draft.kind === MemoryKind.Preference
                      ? i18nService.t('managedMemoryKindPreference')
                      : i18nService.t('managedMemoryKindDecision')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={MemoryKind.Preference}>
                      {i18nService.t('managedMemoryKindPreference')}
                    </SelectItem>
                    <SelectItem value={MemoryKind.Decision}>
                      {i18nService.t('managedMemoryKindDecision')}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="managed-memory-sensitivity">
                {i18nService.t('managedMemoryFieldSensitivity')}
              </FieldLabel>
              <Select
                value={draft.sensitivity}
                onValueChange={value =>
                  onChange({
                    sensitivity:
                      value === MemorySensitivity.Sensitive
                        ? MemorySensitivity.Sensitive
                        : MemorySensitivity.Normal,
                  })
                }
              >
                <SelectTrigger id="managed-memory-sensitivity" className="w-full">
                  <SelectValue>
                    {draft.sensitivity === MemorySensitivity.Sensitive
                      ? i18nService.t('managedMemorySensitivitySensitive')
                      : i18nService.t('managedMemorySensitivityNormal')}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={MemorySensitivity.Normal}>
                      {i18nService.t('managedMemorySensitivityNormal')}
                    </SelectItem>
                    <SelectItem value={MemorySensitivity.Sensitive}>
                      {i18nService.t('managedMemorySensitivitySensitive')}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </FieldGroup>
        <DialogFooter className="shrink-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
            {i18nService.t('cancel')}
          </Button>
          <Button type="button" onClick={onSave} disabled={!valid || busy}>
            {busy && <Spinner data-icon="inline-start" />}
            {i18nService.t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function scopeLabel(scope: ManagedMemoryRecord['scope']): string {
  if (scope === MemoryScope.Personal) return i18nService.t('managedMemoryScopePersonal');
  if (scope === MemoryScope.Session) return i18nService.t('managedMemoryScopeSession');
  return i18nService.t('managedMemoryScopeProject');
}
