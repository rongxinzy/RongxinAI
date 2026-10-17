import { Button } from '@shared/components/ui/button';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@shared/components/ui/empty';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@shared/components/ui/popover';
import { cn } from '@shared/lib/utils';
import { Filter } from 'lucide-react';
import React, { useState } from 'react';

import { i18nService } from '../../../services/i18n';
import { Skill } from '../../../types/skill';
import { PlusMenuSkillsIcon } from '../../cowork/plusMenuIcons';
import { ListPagination } from '../../common/ListPagination';
import { skillCategories, SkillCategory, SkillCategoryTranslationKey } from '../constants';
import { InstalledSkillGrid } from '../InstalledSkillGrid';

interface InstalledSkillsPanelProps {
  readOnly?: boolean;
  /** Every locally installed skill; drives the empty-state copy. */
  installedSkills: Skill[];
  filteredSkills: Skill[];
  paginatedSkills: Skill[];
  pageNumber: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  gridScrollRef: React.RefObject<HTMLDivElement | null>;
  category: SkillCategory;
  onCategoryChange: (category: SkillCategory) => void;
  isBatchMode: boolean;
  isBatchUpdating: boolean;
  selectedVisibleIds: Set<string>;
  selectedUninstallableIds: Set<string>;
  onEnterBatchMode: () => void;
  onExitBatchMode: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onToggleSelection: (skillId: string) => void;
  onBatchToggle: (enabled: boolean) => void;
  onBatchUninstall: () => void;
  onClearFilters: () => void;
  onSelectSkill: (skill: Skill) => void;
  onToggleSkill: (skillId: string) => void;
  onTrySkill?: (skillId: string) => void;
  resolveName: (id: string, fallback: string) => string;
}

/**
 * Installed-tab view: category filter, batch-management toolbar, the skill
 * grid with pagination, and the filtered/empty states. All list state lives
 * in SkillsManager via useInstalledSkillList; this component is
 * presentational.
 */
export const InstalledSkillsPanel: React.FC<InstalledSkillsPanelProps> = ({
  readOnly,
  installedSkills,
  filteredSkills,
  paginatedSkills,
  pageNumber,
  pageCount,
  onPageChange,
  gridScrollRef,
  category,
  onCategoryChange,
  isBatchMode,
  isBatchUpdating,
  selectedVisibleIds,
  selectedUninstallableIds,
  onEnterBatchMode,
  onExitBatchMode,
  onSelectAll,
  onClearSelection,
  onToggleSelection,
  onBatchToggle,
  onBatchUninstall,
  onClearFilters,
  onSelectSkill,
  onToggleSkill,
  onTrySkill,
  resolveName,
}) => {
  const [isCategoryFilterOpen, setIsCategoryFilterOpen] = useState(false);

  const categoryFilterControl = (
    <Popover open={isCategoryFilterOpen} onOpenChange={setIsCategoryFilterOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={i18nService.t('skillFilter')}
          >
            <Filter data-icon="inline-start" />
            {i18nService.t(SkillCategoryTranslationKey[category])}
          </Button>
        }
      />
      <PopoverContent align="end" className="w-56">
        <PopoverTitle>{i18nService.t('skillFilter')}</PopoverTitle>
        <div className="h-64 w-full overflow-y-scroll pr-1">
          <div className="grid grid-cols-1 gap-1.5">
            {skillCategories.map(item => (
              <Button
                key={item}
                type="button"
                variant="ghost"
                size="sm"
                className={cn(
                  'theme-page-skills-manager-button-variant-1 w-full justify-start',
                  category === item && 'theme-page-skills-manager-button-variant-2',
                )}
                onClick={() => {
                  onCategoryChange(item);
                  setIsCategoryFilterOpen(false);
                }}
              >
                {i18nService.t(SkillCategoryTranslationKey[item])}
              </Button>
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div
        className={cn(
          'mb-4 flex w-full min-h-9 flex-wrap items-center gap-3 px-1 text-sm text-muted-foreground',
          isBatchMode ? 'justify-between' : 'justify-end',
        )}
      >
        {!isBatchMode ? (
          <div className="flex items-center gap-2">
            {categoryFilterControl}
            <Button size="sm" variant="ghost" disabled={readOnly} onClick={onEnterBatchMode}>
              {i18nService.t('skillBatchManage')}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3">
              <span>
                {i18nService
                  .t('skillBatchSelected')
                  .replace('{count}', String(selectedVisibleIds.size))}
              </span>
              <Button type="button" variant="ghost" size="sm" onClick={onSelectAll}>
                {i18nService.t('skillSelectAll')}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={onClearSelection}>
                {i18nService.t('skillClearSelection')}
              </Button>
            </div>
            <div className="flex items-center gap-3">
              {categoryFilterControl}
              <Button
                className="min-w-16"
                size="sm"
                variant="outline"
                disabled={readOnly || !selectedVisibleIds.size || isBatchUpdating}
                onClick={() => onBatchToggle(true)}
              >
                {i18nService.t('skillBatchEnable')}
              </Button>
              <Button
                className="min-w-16"
                size="sm"
                variant="outline"
                disabled={readOnly || !selectedVisibleIds.size || isBatchUpdating}
                onClick={() => onBatchToggle(false)}
              >
                {i18nService.t('skillBatchDisable')}
              </Button>
              <Button
                className="min-w-16"
                size="sm"
                variant="outline"
                disabled={readOnly || !selectedUninstallableIds.size || isBatchUpdating}
                onClick={onBatchUninstall}
              >
                {i18nService.t('skillUninstall')}
              </Button>
              <Button
                type="button"
                className="ml-2"
                variant="ghost"
                size="sm"
                onClick={onExitBatchMode}
              >
                {i18nService.t('cancel')}
              </Button>
            </div>
          </>
        )}
      </div>
      <div ref={gridScrollRef} className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-stable">
        {filteredSkills.length === 0 ? (
          <Empty className="min-h-48 border border-dashed">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <PlusMenuSkillsIcon />
              </EmptyMedia>
              <EmptyTitle>
                {installedSkills.length === 0
                  ? i18nService.t('skillInstalledEmpty')
                  : i18nService.t('noMatchingSkills')}
              </EmptyTitle>
              <EmptyDescription>
                {installedSkills.length === 0
                  ? i18nService.t('skillInstalledEmptyDescription')
                  : i18nService.t('skillInstalledNoMatchDescription')}
              </EmptyDescription>
            </EmptyHeader>
            {installedSkills.length > 0 && (
              <EmptyContent>
                <Button type="button" size="sm" variant="outline" onClick={onClearFilters}>
                  {i18nService.t('skillFilterClear')}
                </Button>
              </EmptyContent>
            )}
          </Empty>
        ) : (
          <InstalledSkillGrid
            skills={paginatedSkills}
            readOnly={readOnly}
            onSelect={onSelectSkill}
            onToggle={onToggleSkill}
            onTrySkill={onTrySkill}
            resolveName={resolveName}
            selectedIds={isBatchMode ? selectedVisibleIds : new Set()}
            onSelectToggle={onToggleSelection}
            batchMode={isBatchMode}
          />
        )}
      </div>
      <ListPagination
        page={pageNumber}
        totalPages={pageCount}
        className="shrink-0 py-4"
        onPageChange={onPageChange}
      />
    </div>
  );
};
