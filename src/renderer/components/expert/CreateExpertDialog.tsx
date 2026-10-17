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
import { cn } from '@shared/lib/utils';
import { Cable, Check, FileText, MessageSquare, Sparkles } from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { i18nService } from '../../services/i18n';
import type { RootState } from '../../store';
import type { Agent, CreateAgentRequest, UpdateAgentRequest } from '../../types/agent';
import { CUSTOM_EXPERT_GRADIENTS, CUSTOM_EXPERT_ICONS, ExpertAvatar } from './expertAvatars';

interface CreateExpertDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  expertToEdit?: Agent | null;
  onSaved: (agent: Agent, shouldStartChat?: boolean) => void;
}

const PROMPT_TEMPLATES = [
  {
    nameKey: 'templateAnalysis',
    name: '数据分析 SOP',
    prompt: `# 数据分析专家 SOP
你是具有麦肯锡与顶级科技企业背景的资深数据分析专家。
## 核心原则
1. 结论先行：所有回答首先给出确定性核心发现与决策建议。
2. 数据自洽：在调用分析工具（如 xlsx、数据库查询）前先做数据质量与口径核验。
3. 可视化表达：关键对比与趋势必须输出明确的图表规范与置信度。

## 工作流
Phase 1: 需求拆解与指标定义
Phase 2: 数据清洗与异常诊断
Phase 3: 归因分析与决策洞察输出`,
  },
  {
    nameKey: 'templateArchitect',
    name: '系统架构 SOP',
    prompt: `# 系统架构专家 SOP
你是资深系统架构师，负责技术决策、代码安全与架构设计。
## 核心原则
1. 设计合规：严格遵循模块化、高内聚低耦合原则。
2. 渐进重构：任何重构必须具备边界测试与性能证据。
3. 可维护性优先：提供清晰的类型契约与接口设计。

## 工作流
Phase 1: 上下文调研与现有架构评估
Phase 2: 技术方案设计与边界论证
Phase 3: 代码落地与回归验证`,
  },
  {
    nameKey: 'templateResearch',
    name: '深度研究 SOP',
    prompt: `# 深度调研专家 SOP
你是证据驱动的商业与产业深度研究专家。
## 核心原则
1. 证据第一：不编造未经引用的事实，所有数据均给出可靠出处。
2. 跨度交叉验证：综合行业研报、公开财报与实时网络检索。
3. 结构化交付：输出包含执行摘要、核心洞察、风险预警的完整纪要。

## 工作流
Phase 1: 明确研究主题与关键词池
Phase 2: 收集多源公开证据与统计数据
Phase 3: 提炼洞察并输出 executive summary`,
  },
];

export const CreateExpertDialog: React.FC<CreateExpertDialogProps> = ({
  open,
  onOpenChange,
  expertToEdit,
  onSaved,
}) => {
  const skills = useSelector((state: RootState) => state.skill.skills);
  const mcpServers = useSelector((state: RootState) => state.mcp.servers);

  const [name, setName] = useState('');
  const [profession, setProfession] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('brain');
  const [selectedGradient, setSelectedGradient] = useState(CUSTOM_EXPERT_GRADIENTS[0]);
  const [selectedSkillIds, setSelectedSkillIds] = useState<string[]>([]);
  const [selectedMcpIds, setSelectedMcpIds] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [skillSearch, setSkillSearch] = useState('');
  const [mcpSearch, setMcpSearch] = useState('');

  const isEdit = Boolean(expertToEdit);

  useEffect(() => {
    if (!open) return;
    if (expertToEdit) {
      setName(expertToEdit.name || '');
      setProfession(expertToEdit.identity || '');
      setDescription(expertToEdit.description || '');
      setSystemPrompt(expertToEdit.systemPrompt || '');
      setSelectedSkillIds(expertToEdit.skillIds || []);
      setSelectedMcpIds(expertToEdit.mcpIds || []);

      if (expertToEdit.icon && expertToEdit.icon.startsWith('custom:')) {
        const parts = expertToEdit.icon.split(':');
        setSelectedIcon(parts[1] || 'brain');
        setSelectedGradient(parts[2] || CUSTOM_EXPERT_GRADIENTS[0]);
      } else {
        setSelectedIcon('brain');
        setSelectedGradient(CUSTOM_EXPERT_GRADIENTS[0]);
      }
    } else {
      setName('');
      setProfession('');
      setDescription('');
      setSystemPrompt('');
      setSelectedIcon('brain');
      setSelectedGradient(CUSTOM_EXPERT_GRADIENTS[0]);
      setSelectedSkillIds([]);
      setSelectedMcpIds([]);
    }
    setError('');
  }, [open, expertToEdit]);

  const filteredSkills = useMemo(() => {
    const q = skillSearch.trim().toLowerCase();
    return skills.filter(
      s => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [skills, skillSearch]);

  const filteredMcpServers = useMemo(() => {
    const q = mcpSearch.trim().toLowerCase();
    return mcpServers.filter(
      s => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
  }, [mcpServers, mcpSearch]);

  const toggleSkill = (id: string) => {
    setSelectedSkillIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const toggleMcp = (id: string) => {
    setSelectedMcpIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  };

  const handleSave = async (startChat = false) => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(i18nService.t('expertNameRequired'));
      return;
    }
    if (!systemPrompt.trim()) {
      setError('系统提示词与SOP不能为空');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const iconValue = `custom:${selectedIcon}:${selectedGradient}`;
      let savedAgent: Agent | null = null;

      if (isEdit && expertToEdit) {
        const updatePayload: UpdateAgentRequest = {
          name: trimmedName,
          identity: profession.trim(),
          description: description.trim(),
          systemPrompt: systemPrompt.trim(),
          icon: iconValue,
          skillIds: selectedSkillIds,
          mcpIds: selectedMcpIds,
        };
        const res = await agentService.updateAgent(expertToEdit.id, updatePayload);
        if (!res) {
          throw new Error('Failed to update expert');
        }
        savedAgent = res;
      } else {
        const createPayload: CreateAgentRequest = {
          name: trimmedName,
          identity: profession.trim(),
          description: description.trim(),
          systemPrompt: systemPrompt.trim(),
          icon: iconValue,
          skillIds: selectedSkillIds,
          mcpIds: selectedMcpIds,
          source: 'custom',
        };
        const res = await agentService.createAgent(createPayload);
        if (!res) {
          throw new Error('Failed to create expert');
        }
        savedAgent = res;
      }

      onOpenChange(false);
      onSaved(savedAgent, startChat);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col p-6 gap-5">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">
            {isEdit ? i18nService.t('editExpert') : i18nService.t('createExpert')}
          </DialogTitle>
          <p className="text-xs text-muted-foreground">{i18nService.t('expertsDescription')}</p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 flex flex-col gap-5">
          {error && (
            <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-xs text-destructive">
              {error}
            </div>
          )}

          {/* Basic Info: Name & Profession */}
          <div className="flex gap-4 items-start">
            {/* Avatar Preview & Customization */}
            <div className="flex flex-col items-center gap-2 pt-1">
              <ExpertAvatar
                name={name || 'custom'}
                label={name || 'E'}
                icon={`custom:${selectedIcon}:${selectedGradient}`}
                className="size-14 text-xl"
              />
              <span className="text-[11px] text-muted-foreground">头像预览</span>
            </div>

            <div className="flex-1 flex flex-col gap-3">
              <Field>
                <FieldLabel className="text-xs font-medium">
                  {i18nService.t('expertName')} <span className="text-destructive">*</span>
                </FieldLabel>
                <Input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="例如：商业分析专家、架构重构专家"
                  className="h-9 text-sm"
                  maxLength={40}
                />
              </Field>

              <Field>
                <FieldLabel className="text-xs font-medium">
                  {i18nService.t('expertProfession')}
                </FieldLabel>
                <Input
                  value={profession}
                  onChange={e => setProfession(e.target.value)}
                  placeholder="例如：资深数据科学家 / 首席架构师"
                  className="h-9 text-sm"
                  maxLength={40}
                />
              </Field>
            </div>
          </div>

          {/* Avatar Customization Pickers */}
          <div className="rounded-lg border border-border/60 bg-muted/30 p-3.5 flex flex-col gap-2.5">
            <span className="text-xs font-medium text-foreground">定制专家徽标与配色</span>
            <div className="flex flex-wrap items-center gap-2">
              {Object.entries(CUSTOM_EXPERT_ICONS).map(([key, IconComponent]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedIcon(key)}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-lg border transition-all',
                    selectedIcon === key
                      ? 'border-primary bg-primary/10 text-primary scale-105'
                      : 'border-border/60 bg-background text-muted-foreground hover:bg-muted',
                  )}
                >
                  <IconComponent className="size-4" />
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
              {CUSTOM_EXPERT_GRADIENTS.map((gradient, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setSelectedGradient(gradient)}
                  style={{ background: gradient }}
                  className={cn(
                    'size-6 rounded-full transition-transform',
                    selectedGradient === gradient
                      ? 'ring-2 ring-primary ring-offset-2 scale-110'
                      : 'opacity-85 hover:opacity-100',
                  )}
                />
              ))}
            </div>
          </div>

          {/* One-line Description */}
          <Field>
            <FieldLabel className="text-xs font-medium">
              {i18nService.t('expertDescription')}
            </FieldLabel>
            <Input
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="一句话概括专家的核心能力与适用场景..."
              className="h-9 text-sm"
              maxLength={120}
            />
          </Field>

          {/* System Prompt & SOP */}
          <Field>
            <div className="flex items-center justify-between pb-1">
              <FieldLabel className="text-xs font-medium">
                {i18nService.t('expertSystemPrompt')} <span className="text-destructive">*</span>
              </FieldLabel>
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-muted-foreground mr-1">快速套用模板:</span>
                {PROMPT_TEMPLATES.map(tpl => (
                  <Button
                    key={tpl.name}
                    type="button"
                    variant="outline"
                    size="xs"
                    className="h-6 text-[11px] px-2"
                    onClick={() => setSystemPrompt(tpl.prompt)}
                  >
                    <FileText className="size-3 mr-1" />
                    {tpl.name}
                  </Button>
                ))}
              </div>
            </div>
            <Textarea
              value={systemPrompt}
              onChange={e => setSystemPrompt(e.target.value)}
              placeholder={i18nService.t('expertSystemPromptPlaceholder')}
              rows={6}
              className="text-xs font-mono resize-y leading-relaxed"
            />
          </Field>

          {/* Bound Skills (Multi-select) */}
          <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-primary" />
                {i18nService.t('expertBoundSkills')}
                <span className="text-[11px] text-muted-foreground font-normal">
                  ({selectedSkillIds.length} 已选)
                </span>
              </span>
              <Input
                value={skillSearch}
                onChange={e => setSkillSearch(e.target.value)}
                placeholder="过滤技能..."
                className="h-7 w-44 text-xs"
              />
            </div>

            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pt-1">
              {filteredSkills.length === 0 ? (
                <span className="text-xs text-muted-foreground py-2">暂无可用技能</span>
              ) : (
                filteredSkills.map(skill => {
                  const isChecked = selectedSkillIds.includes(skill.id);
                  return (
                    <button
                      key={skill.id}
                      type="button"
                      onClick={() => toggleSkill(skill.id)}
                      className={cn(
                        'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all border',
                        isChecked
                          ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                          : 'bg-background text-foreground/80 border-border/80 hover:bg-muted',
                      )}
                    >
                      {isChecked && <Check className="size-3 stroke-[2.5]" />}
                      <span>{skill.name}</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Bound MCP Connectors (Multi-select) */}
          <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/20 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Cable className="size-3.5 text-primary" />
                {i18nService.t('expertBoundMcp')}
                <span className="text-[11px] text-muted-foreground font-normal">
                  ({selectedMcpIds.length} 已选)
                </span>
              </span>
              <Input
                value={mcpSearch}
                onChange={e => setMcpSearch(e.target.value)}
                placeholder="过滤连接器..."
                className="h-7 w-44 text-xs"
              />
            </div>

            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pt-1">
              {filteredMcpServers.length === 0 ? (
                <span className="text-xs text-muted-foreground py-2">
                  暂无已配置连接器，可在“连接器”模块配置或导入
                </span>
              ) : (
                filteredMcpServers.map(server => {
                  const isChecked = selectedMcpIds.includes(server.id);
                  return (
                    <button
                      key={server.id}
                      type="button"
                      onClick={() => toggleMcp(server.id)}
                      className={cn(
                        'inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all border',
                        isChecked
                          ? 'bg-primary text-primary-foreground border-primary shadow-xs'
                          : 'bg-background text-foreground/80 border-border/80 hover:bg-muted',
                      )}
                    >
                      {isChecked && <Check className="size-3 stroke-[2.5]" />}
                      <span>{server.name}</span>
                      <span className="text-[10px] opacity-70">({server.transportType})</span>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="pt-2">
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
            variant="secondary"
            onClick={() => void handleSave(false)}
            disabled={isSubmitting}
          >
            {i18nService.t('save')}
          </Button>
          <Button
            type="button"
            variant="default"
            onClick={() => void handleSave(true)}
            disabled={isSubmitting}
          >
            <MessageSquare className="size-3.5 mr-1" />
            {i18nService.t('expertSaveAndChat')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
