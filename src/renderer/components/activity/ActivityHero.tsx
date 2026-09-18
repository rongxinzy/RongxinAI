import { Activity } from 'lucide-react';
import React from 'react';

import { i18nService } from '../../services/i18n';

// 2026/09/15 lixiang  从 ActivityView 抽出活动页样式头（图标 + 描述）
/** Activity page hero: brand icon + short description under PageHeader. */
const ActivityHero: React.FC = () => (
  <section className="animate-fade-in-up shrink-0 pt-3 pb-3">
    <div className="flex items-center gap-4">
      <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary-muted">
        <Activity className="size-6 text-primary" />
      </div>
      <p className="min-w-0 text-sm text-muted-foreground">
        {i18nService.t('activityHeroDesc')}
      </p>
    </div>
  </section>
);

export default ActivityHero;
