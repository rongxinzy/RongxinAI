import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@shared/components/ui/card';
import {
  CalendarClock,
  CloudSun,
  Lightbulb,
  Newspaper,
  SlidersHorizontal,
  TrendingUp,
} from 'lucide-react';
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

const TEMPLATES: TaskTemplate[] = [
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
  onCustom: () => void;
}

const TaskTemplateGallery: React.FC<TaskTemplateGalleryProps> = ({
  onSelectTemplate,
  onCustom,
}) => {
  return (
    <div className="flex w-full flex-col gap-6 py-6">
      <div>
        <h2 className="text-base font-semibold text-foreground mb-1">
          {i18nService.t('taskTemplateSectionTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">{i18nService.t('taskTemplateSectionDesc')}</p>
      </div>

      {/* Template Cards Grid */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {TEMPLATES.map(tpl => (
          <Card
            key={tpl.id}
            className="theme-page-task-template-gallery-card-1 cursor-pointer h-full"
            onClick={() =>
              onSelectTemplate({
                name: i18nService.t(tpl.nameKey as Parameters<typeof i18nService.t>[0]),
                description: i18nService.t(tpl.descKey as Parameters<typeof i18nService.t>[0]),
                schedule: tpl.schedule,
                promptText: i18nService.t(tpl.promptTextKey as Parameters<typeof i18nService.t>[0]),
              })
            }
          >
            <CardHeader>
              <div className="size-9 rounded-lg flex items-center justify-center mb-1 bg-surface-raised text-muted-foreground">
                <tpl.icon className="size-4.5" />
              </div>
              <CardTitle>
                {i18nService.t(tpl.nameKey as Parameters<typeof i18nService.t>[0])}
              </CardTitle>
              <CardDescription>
                {i18nService.t(tpl.descKey as Parameters<typeof i18nService.t>[0])}
              </CardDescription>
            </CardHeader>
            <CardContent className="mt-auto">
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground bg-muted rounded-md px-2 py-1">
                <CalendarClock className="size-3" />
                {i18nService.t(tpl.scheduleLabelKey as Parameters<typeof i18nService.t>[0])}
              </span>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Custom Task */}
      <Card className="theme-page-task-template-gallery-card-2 cursor-pointer" onClick={onCustom}>
        <CardHeader>
          <div className="flex items-start gap-2">
            <div className="size-9 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground bg-muted">
              <SlidersHorizontal className="size-4.5" />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle className="theme-control-muted">
                {i18nService.t('taskTemplateCustomName')}
              </CardTitle>
              <CardDescription>{i18nService.t('taskTemplateCustomDesc')}</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>
    </div>
  );
};

export default TaskTemplateGallery;
