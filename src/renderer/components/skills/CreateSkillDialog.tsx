import { Button } from '@shared/components/ui/button';
import { Alert, AlertDescription } from '@shared/components/ui/alert';
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
import { Textarea } from '@shared/components/ui/textarea';
import { FileText } from 'lucide-react';
import React, { useEffect, useId, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import { setSkills } from '../../store/slices/skillSlice';

interface CreateSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (createdSkillId: string) => void;
}

const CreateSkillDialog: React.FC<CreateSkillDialogProps> = ({ open, onOpenChange, onSuccess }) => {
  const dispatch = useDispatch();
  const [skillId, setSkillId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);
  const formId = useId();
  const idRef = useRef<HTMLInputElement>(null);
  const t = (key: string) => i18nService.t(key);

  useEffect(() => {
    if (open) {
      setSkillId('');
      setName('');
      setDescription('');
      // The main-process API writes name/description/frontmatter once; this editor owns the body.
      setContent(i18nService.t('skillBodyTemplate'));
      setError('');
    }
  }, [open]);

  const handleGenerateTemplate = () => {
    setContent(t('skillBodyTemplate'));
  };

  const handleSave = async () => {
    if (submitting.current) return;
    const trimmedId = skillId.trim().toLowerCase();
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    const trimmedContent = content.trim();

    if (!trimmedId) {
      setError('skillIdentifierRequired');
      idRef.current?.focus();
      return;
    }

    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(trimmedId)) {
      setError('skillIdInvalid');
      return;
    }

    if (!trimmedName) {
      setError('skillNameRequired');
      return;
    }

    if (!trimmedContent) {
      setError('skillContentRequired');
      return;
    }

    submitting.current = true;
    setIsSubmitting(true);
    setError('');

    try {
      const res = await skillService.createCustomSkill({
        id: trimmedId,
        name: trimmedName,
        description: trimmedDesc,
        content: trimmedContent,
      });

      if (!res.success) {
        setError(
          res.error?.includes('already exists')
            ? 'skillIdentifierExists'
            : res.error?.includes('built-in')
              ? 'skillIdentifierReserved'
              : 'skillCreateError',
        );
        return;
      }

      // Refresh installed skills in Redux
      const installed = await skillService.loadSkills();
      dispatch(setSkills(installed));

      onOpenChange(false);
      onSuccess?.(trimmedId);
    } catch {
      setError('skillCreateError');
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!submitting.current) onOpenChange(next);
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-2xl"
        closeLabel={t('close')}
        showCloseButton={!isSubmitting}
      >
        <DialogHeader>
          <DialogTitle>{i18nService.t('createCustomSkill')}</DialogTitle>
          <DialogDescription>{t('createCustomSkillDesc')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {error && (
            <Alert variant="destructive" className="mb-4" id={`${formId}-error`}>
              <AlertDescription>{t(error)}</AlertDescription>
            </Alert>
          )}

          <FieldGroup className="gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field>
                <FieldLabel htmlFor={`${formId}-id`}>{i18nService.t('skillIdentifier')}</FieldLabel>
                <Input
                  id={`${formId}-id`}
                  ref={idRef}
                  autoFocus
                  required
                  value={skillId}
                  onChange={e =>
                    setSkillId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                  }
                  placeholder={i18nService.t('skillIdentifierPlaceholder')}
                  disabled={isSubmitting}
                  aria-invalid={
                    error === 'skillIdentifierRequired' ||
                    error === 'skillIdInvalid' ||
                    error === 'skillIdentifierExists' ||
                    error === 'skillIdentifierReserved'
                  }
                  aria-describedby={error ? `${formId}-error` : undefined}
                  maxLength={40}
                />
              </Field>

              <Field>
                <FieldLabel htmlFor={`${formId}-name`}>
                  {i18nService.t('skillNameLabel')}
                </FieldLabel>
                <Input
                  id={`${formId}-name`}
                  required
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder={i18nService.t('skillNamePlaceholder')}
                  disabled={isSubmitting}
                  aria-invalid={error === 'skillNameRequired'}
                  maxLength={50}
                />
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor={`${formId}-description`}>
                {i18nService.t('skillDescriptionLabel')}
              </FieldLabel>
              <Input
                id={`${formId}-description`}
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={i18nService.t('skillDescriptionPlaceholder')}
                disabled={isSubmitting}
                maxLength={200}
              />
            </Field>

            <Field>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <FieldLabel htmlFor={`${formId}-content`}>
                  {i18nService.t('skillContentLabel')}
                </FieldLabel>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleGenerateTemplate}
                  disabled={isSubmitting}
                  className="gap-1"
                >
                  <FileText />
                  {t('skillUseTemplate')}
                </Button>
              </div>
              <Textarea
                id={`${formId}-content`}
                autoGrow={false}
                rows={12}
                required
                disabled={isSubmitting}
                aria-invalid={error === 'skillContentRequired'}
                value={content}
                onChange={e => setContent(e.target.value)}
                spellCheck={false}
              />
            </Field>
          </FieldGroup>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {i18nService.t('cancel')}
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={() => void handleSave()}
            disabled={isSubmitting}
          >
            {isSubmitting ? i18nService.t('saving') : i18nService.t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreateSkillDialog;
