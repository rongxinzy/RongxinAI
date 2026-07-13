import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/components/ui/card';
import { cn } from '@shared/lib/utils';
import { CalendarClock, CloudSun, Lightbulb, Newspaper, TrendingUp } from 'lucide-react';
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
  colorClass: string;
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
    colorClass: 'text-emerald-500 bg-emerald-500/10',
    schedule: { kind: 'cron', expr: '0 9 * * *' },
  },
  {
    id: 'weather',
    icon: CloudSun,
    nameKey: 'taskTemplateWeatherName',
    descKey: 'taskTemplateWeatherDesc',
    scheduleLabelKey: 'taskTemplateWeatherSchedule',
    promptTextKey: 'taskTemplateWeatherPrompt',
    colorClass: 'text-sky-500 bg-sky-500/10',
    schedule: { kind: 'cron', expr: '0 7 * * *' },
  },
  {
    id: 'news-briefing',
    icon: Newspaper,
    nameKey: 'taskTemplateNewsBriefingName',
    descKey: 'taskTemplateNewsBriefingDesc',
    scheduleLabelKey: 'taskTemplateNewsBriefingSchedule',
    promptTextKey: 'taskTemplateNewsBriefingPrompt',
    colorClass: 'text-blue-500 bg-blue-500/10',
    schedule: { kind: 'cron', expr: '0 8 * * *' },
  },
  {
    id: 'knowledge-push',
    icon: Lightbulb,
    nameKey: 'taskTemplateKnowledgePushName',
    descKey: 'taskTemplateKnowledgePushDesc',
    scheduleLabelKey: 'taskTemplateKnowledgePushSchedule',
    promptTextKey: 'taskTemplateKnowledgePushPrompt',
    colorClass: 'text-amber-500 bg-amber-500/10',
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
    <div className="flex flex-col gap-6 max-w-2xl mx-auto py-6">
      <div>
        <h2 className="text-base font-semibold text-foreground mb-1">
          {i18nService.t('taskTemplateSectionTitle')}
        </h2>
        <p className="text-sm text-muted-foreground">
          {i18nService.t('taskTemplateSectionDesc')}
        </p>
      </div>

      {/* Template Cards Grid */}
      <div className="grid grid-cols-2 gap-3">
        {TEMPLATES.map((tpl) => (
          <Card
            key={tpl.id}
            className="cursor-pointer hover:shadow-md transition-all shadow-sm h-full"
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
              <div
                className={cn(
                  'size-9 rounded-lg flex items-center justify-center mb-1',
                  tpl.colorClass,
                )}
              >
                <tpl.icon className="size-4.5" />
              </div>
              <CardTitle>{i18nService.t(tpl.nameKey as Parameters<typeof i18nService.t>[0])}</CardTitle>
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
      <Card
        className="cursor-pointer border-dashed hover:bg-muted/50 hover:shadow-md transition-all"
        onClick={onCustom}
      >
        <CardHeader>
          <CardTitle className="text-muted-foreground">
            {i18nService.t('taskTemplateCustomName')}
          </CardTitle>
          <CardDescription>
            {i18nService.t('taskTemplateCustomDesc')}
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
};

export default TaskTemplateGallery;
