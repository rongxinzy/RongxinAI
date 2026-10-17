import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Field, FieldLabel } from '@shared/components/ui/field';
import { Input } from '@shared/components/ui/input';
import { Textarea } from '@shared/components/ui/textarea';
import { Sparkles } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { skillService } from '../../services/skill';
import { setSkills } from '../../store/slices/skillSlice';

interface CreateSkillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: (createdSkillId: string) => void;
}

const DEFAULT_SKILL_TEMPLATE = (id: string, name: string, description: string) => `---
name: ${id || 'my-custom-skill'}
description: ${description || '简要描述该技能的作用与触发时机，智能体将据此决定何时启用本技能。'}
---

# ${name || '自定义技能规约'}

## 适用场景 (When to Use)
- 场景 1：当用户提出...
- 场景 2：在处理...任务时

## 核心工作流 (Workflow & SOP)
1. **输入解析**：梳理用户关键诉求与输入数据。
2. **分析与处理**：按照标准业务逻辑执行深度思考与推理。
3. **交付物生成**：输出结构化成果与执行建议。

## 输出规范 (Output Standards)
- 保持结论清晰、数据可靠。
- 重点信息使用结构化表格或条目列出。
`;

const CreateSkillDialog: React.FC<CreateSkillDialogProps> = ({ open, onOpenChange, onSuccess }) => {
  const dispatch = useDispatch();
  const [skillId, setSkillId] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setSkillId('');
      setName('');
      setDescription('');
      setContent(DEFAULT_SKILL_TEMPLATE('', '', ''));
      setError('');
    }
  }, [open]);

  // Update template placeholders when name/id/desc change if content is still template-based
  const handleGenerateTemplate = () => {
    setContent(DEFAULT_SKILL_TEMPLATE(skillId.trim(), name.trim(), description.trim()));
  };

  const handleSave = async () => {
    const trimmedId = skillId.trim().toLowerCase();
    const trimmedName = name.trim();
    const trimmedDesc = description.trim();
    const trimmedContent = content.trim();

    if (!trimmedId) {
      setError(i18nService.t('skillIdentifier') + ' 不能为空');
      return;
    }

    if (!/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/.test(trimmedId)) {
      setError(i18nService.t('skillIdInvalid'));
      return;
    }

    if (!trimmedName) {
      setError(i18nService.t('skillNameRequired'));
      return;
    }

    if (!trimmedContent) {
      setError(i18nService.t('skillContentRequired'));
      return;
    }

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
        setError(res.error || i18nService.t('skillCreateError'));
        return;
      }

      // Refresh installed skills in Redux
      const installed = await skillService.loadSkills();
      dispatch(setSkills(installed));

      onOpenChange(false);
      onSuccess?.(trimmedId);
    } catch (err) {
      setError(err instanceof Error ? err.message : i18nService.t('skillCreateError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-6 gap-5">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {i18nService.t('createCustomSkill')}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{i18nService.t('createCustomSkillDesc')}</p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-4">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field>
              <FieldLabel className="text-xs font-medium">
                {i18nService.t('skillIdentifier')} <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                value={skillId}
                onChange={e => setSkillId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder={i18nService.t('skillIdentifierPlaceholder')}
                className="h-9 text-sm font-mono"
                maxLength={40}
              />
            </Field>

            <Field>
              <FieldLabel className="text-xs font-medium">
                {i18nService.t('skillNameLabel')} <span className="text-destructive">*</span>
              </FieldLabel>
              <Input
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder={i18nService.t('skillNamePlaceholder')}
                className="h-9 text-sm"
                maxLength={50}
              />
            </Field>
          </div>

          <Field>
            <FieldLabel className="text-xs font-medium">
              {i18nService.t('skillDescriptionLabel')}
            </FieldLabel>
            <Input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={i18nService.t('skillDescriptionPlaceholder')}
              className="h-9 text-sm"
              maxLength={200}
            />
          </Field>

          <Field className="flex-1 flex flex-col min-h-60">
            <div className="flex items-center justify-between mb-1.5">
              <FieldLabel className="text-xs font-medium">
                {i18nService.t('skillContentLabel')} <span className="text-destructive">*</span>
              </FieldLabel>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleGenerateTemplate}
                className="h-7 text-xs gap-1 text-muted-foreground hover:text-foreground"
              >
                <Sparkles className="size-3.5" />
                填充规约模板
              </Button>
            </div>
            <Textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              className="flex-1 min-h-[220px] font-mono text-xs leading-relaxed resize-y bg-muted/20"
              spellCheck={false}
            />
          </Field>
        </div>

        <DialogFooter className="flex items-center justify-end gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {i18nService.t('cancel')}
          </Button>
          <Button
            type="button"
            variant="default"
            size="sm"
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
