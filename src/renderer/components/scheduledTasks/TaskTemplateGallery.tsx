import { Button } from '@shared/components/ui/button';
import { CloudSun, Lightbulb, Newspaper, TrendingUp } from 'lucide-react';
import React from 'react';

import { i18nService } from '../../services/i18n';

// ── Template types ──

export interface TaskTemplateValues {
  name: string;
  description: string;
  schedule: { kind: 'cron'; expr: string };
  promptText: string;
}

interface TaskTemplate {
  id: string;
  icon: React.ComponentType<{ className?: string }>;
  nameKey: string;
  descKey: string;
  scheduleLabelKey: string;
  promptTextKey: string;
  schedule: { kind: 'cron'; expr: string };
}

const TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'finance-news',
    icon: TrendingUp,
    nameKey: 'taskTemplateFinanceNewsName',
    descKey: 'taskTemplateFinanceNewsDesc',
    scheduleLabelKey: 'taskTemplateFinanceNewsSchedule',
    promptTextKey: 'taskTemplateFinanceNewsPrompt',
    schedule: { kind: 'cron', expr: '0 9 * * *' },
  },
  {
    id: 'weather',
    icon: CloudSun,
    nameKey: 'taskTemplateWeatherName',
    descKey: 'taskTemplateWeatherDesc',
    scheduleLabelKey: 'taskTemplateWeatherSchedule',
    promptTextKey: 'taskTemplateWeatherPrompt',
    schedule: { kind: 'cron', expr: '0 7 * * *' },
  },
  {
    id: 'news-briefing',
    icon: Newspaper,
    nameKey: 'taskTemplateNewsBriefingName',
    descKey: 'taskTemplateNewsBriefingDesc',
    scheduleLabelKey: 'taskTemplateNewsBriefingSchedule',
    promptTextKey: 'taskTemplateNewsBriefingPrompt',
    schedule: { kind: 'cron', expr: '0 8 * * *' },
  },
  {
    id: 'knowledge-push',
    icon: Lightbulb,
    nameKey: 'taskTemplateKnowledgePushName',
    descKey: 'taskTemplateKnowledgePushDesc',
    scheduleLabelKey: 'taskTemplateKnowledgePushSchedule',
    promptTextKey: 'taskTemplateKnowledgePushPrompt',
    schedule: { kind: 'cron', expr: '0 12 * * *' },
  },
];

// ── Props ──

interface TaskTemplateGalleryProps {
  onSelectTemplate: (values: TaskTemplateValues) => void;
}

const TaskTemplateGallery: React.FC<TaskTemplateGalleryProps> = ({ onSelectTemplate }) => (
  <div className="flex flex-wrap gap-2 py-3">
    {TASK_TEMPLATES.map(template => (
      <Button
        key={template.id}
        variant="outline"
        size="sm"
        title={i18nService.t(template.descKey)}
        onClick={() =>
          onSelectTemplate({
            name: i18nService.t(template.nameKey),
            description: i18nService.t(template.descKey),
            schedule: template.schedule,
            promptText: i18nService.t(template.promptTextKey),
          })
        }
      >
        <template.icon />
        {i18nService.t(template.nameKey)}
      </Button>
    ))}
  </div>
);
export default TaskTemplateGallery;
