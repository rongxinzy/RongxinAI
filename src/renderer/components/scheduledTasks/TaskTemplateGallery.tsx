import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/components/ui/card';
import { cn } from '@shared/lib/utils';
import { BetweenHorizonalEnd, CalendarClock, Code, FileSearch } from 'lucide-react';
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
    id: 'daily-report',
    icon: CalendarClock,
    nameKey: 'taskTemplateDailyReportName',
    descKey: 'taskTemplateDailyReportDesc',
    scheduleLabelKey: 'taskTemplateDailyReportSchedule',
    promptTextKey: 'taskTemplateDailyReportPrompt',
    colorClass: 'text-blue-500 bg-blue-500/10',
    schedule: { kind: 'cron', expr: '0 18 * * *' },
  },
  {
    id: 'code-review',
    icon: Code,
    nameKey: 'taskTemplateCodeReviewName',
    descKey: 'taskTemplateCodeReviewDesc',
    scheduleLabelKey: 'taskTemplateCodeReviewSchedule',
    promptTextKey: 'taskTemplateCodeReviewPrompt',
    colorClass: 'text-purple-500 bg-purple-500/10',
    schedule: { kind: 'cron', expr: '0 10 * * *' },
  },
  {
    id: 'data-inspection',
    icon: FileSearch,
    nameKey: 'taskTemplateDataInspectionName',
    descKey: 'taskTemplateDataInspectionDesc',
    scheduleLabelKey: 'taskTemplateDataInspectionSchedule',
    promptTextKey: 'taskTemplateDataInspectionPrompt',
    colorClass: 'text-emerald-500 bg-emerald-500/10',
    schedule: { kind: 'cron', expr: '0 * * * *' },
  },
  {
    id: 'weekly-report',
    icon: BetweenHorizonalEnd,
    nameKey: 'taskTemplateWeeklyReportName',
    descKey: 'taskTemplateWeeklyReportDesc',
    scheduleLabelKey: 'taskTemplateWeeklyReportSchedule',
    promptTextKey: 'taskTemplateWeeklyReportPrompt',
    colorClass: 'text-orange-500 bg-orange-500/10',
    schedule: { kind: 'cron', expr: '0 17 * * 5' },
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
            className="cursor-pointer hover:shadow-md transition-all shadow-sm"
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
            <CardContent>
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
