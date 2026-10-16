import { isCoreSkill } from '@shared/skills/constants';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../../../services/i18n';
import { skillService } from '../../../services/skill';
import { RootState } from '../../../store';
import { setSkills } from '../../../store/slices/skillSlice';
import { SKILL_PAGE_SIZE, SkillCategory, SkillTab } from '../constants';
import { filterInstalledSkills } from './skillMatching';

interface UseInstalledSkillListOptions {
  activeTab: SkillTab;
  skillCategory: SkillCategory;
  searchQuery: string;
  setSkillActionError: (message: string) => void;
  showToast: (message: string) => void;
}

/**
 * Installed-tab list state: loads installed skills from the service and
 * keeps them in the store, then owns filtering, pagination and batch
 * selection/actions over that list.
 */
export function useInstalledSkillList({
  activeTab,
  skillCategory,
  searchQuery,
  setSkillActionError,
  showToast,
}: UseInstalledSkillListOptions) {
  const dispatch = useDispatch();
  const skills = useSelector((state: RootState) => state.skill.skills);

  const [selectedInstalledIds, setSelectedInstalledIds] = useState<Set<string>>(new Set());
  const [installedPageNumber, setInstalledPageNumber] = useState(1);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);
  const installedGridScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let isActive = true;
    const loadSkills = async () => {
      const loadedSkills = await skillService.loadSkills();
      if (!isActive) return;
      dispatch(setSkills(loadedSkills));
    };
    loadSkills();

    const unsubscribe = skillService.onSkillsChanged(async () => {
      const loadedSkills = await skillService.loadSkills();
      if (!isActive) return;
      dispatch(setSkills(loadedSkills));
    });

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [dispatch]);

  // The installed tab contains every locally installed skill. Enabled state
  // controls runtime availability, not whether the card is listed.
  const installedSkills = skills;
  const filteredInstalledSkills = useMemo(
    () => filterInstalledSkills(installedSkills, skillCategory, searchQuery),
    [installedSkills, skillCategory, searchQuery],
  );
  const installedPageCount = Math.max(
    1,
    Math.ceil(filteredInstalledSkills.length / SKILL_PAGE_SIZE),
  );
  const paginatedInstalledSkills = useMemo(() => {
    const start = (installedPageNumber - 1) * SKILL_PAGE_SIZE;
    return filteredInstalledSkills.slice(start, start + SKILL_PAGE_SIZE);
  }, [filteredInstalledSkills, installedPageNumber]);

  useEffect(() => {
    setInstalledPageNumber(1);
  }, [activeTab, skillCategory, searchQuery]);

  useEffect(() => {
    setInstalledPageNumber(current => Math.min(current, installedPageCount));
  }, [installedPageCount]);

  useEffect(() => {
    installedGridScrollRef.current?.scrollTo({ top: 0 });
  }, [installedPageNumber]);

  const selectedVisibleIds = useMemo(() => {
    const visibleIds = new Set(filteredInstalledSkills.map(skill => skill.id));
    return new Set([...selectedInstalledIds].filter(id => visibleIds.has(id)));
  }, [filteredInstalledSkills, selectedInstalledIds]);
  const selectedUninstallableIds = useMemo(
    () =>
      new Set(
        [...selectedVisibleIds].filter(id => {
          const skill = skills.find(item => item.id === id);
          return skill && !skill.isBuiltIn;
        }),
      ),
    [selectedVisibleIds, skills],
  );

  useEffect(() => {
    setSelectedInstalledIds(new Set());
  }, [activeTab, skillCategory]);

  const toggleInstalledSelection = (skillId: string) => {
    setSelectedInstalledIds(current => {
      const next = new Set(current);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };

  const batchToggleInstalled = async (enabled: boolean) => {
    const ids = [...selectedVisibleIds].filter(id => {
      const skill = skills.find(item => item.id === id);
      // Core skills cannot be disabled; exclude them from disable batches.
      if (!enabled && isCoreSkill(id)) return false;
      return skill?.enabled !== enabled;
    });
    if (ids.length === 0) return;

    setIsBatchUpdating(true);
    try {
      const updatedSkills = await skillService.setSkillsEnabled(ids, enabled);
      dispatch(setSkills(updatedSkills));
      setSkillActionError('');
      showToast(
        enabled ? i18nService.t('skillEnableSuccess') : i18nService.t('skillDisableSuccess'),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : i18nService.t('skillUpdateFailed');
      setSkillActionError(message);
      showToast(enabled ? i18nService.t('skillEnableFailed') : i18nService.t('skillDisableFailed'));
    } finally {
      setIsBatchUpdating(false);
    }
  };

  return {
    installedSkills,
    filteredInstalledSkills,
    paginatedInstalledSkills,
    installedPageNumber,
    setInstalledPageNumber,
    installedPageCount,
    installedGridScrollRef,
    selectedVisibleIds,
    selectedUninstallableIds,
    selectedInstalledIds,
    setSelectedInstalledIds,
    toggleInstalledSelection,
    isBatchMode,
    setIsBatchMode,
    isBatchUpdating,
    batchToggleInstalled,
  };
}
