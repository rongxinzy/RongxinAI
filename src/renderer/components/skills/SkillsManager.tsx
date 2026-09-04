import { Button } from '@shared/components/ui/button';
import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { Input } from '@shared/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@shared/components/ui/popover';
import { cn } from '@shared/lib/utils';
import { Filter, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';

import type { SkillSecurityReport as SkillSecurityReportData } from '../../../main/libs/skillSecurity/skillSecurityTypes';
import { i18nService } from '../../services/i18n';
import { resolveLocalizedText, skillService } from '../../services/skill';
import { RootState } from '../../store';
import { setSkills } from '../../store/slices/skillSlice';
import { MarketplaceSkill, Skill } from '../../types/skill';
import { isCoreSkill } from '@shared/skills/constants';
import Modal from '../common/Modal';
import ErrorMessage from '../ErrorMessage';
import { ListPagination } from '../common/ListPagination';
import {
  getSkillCategory,
  SKILL_PAGE_SIZE,
  skillCategories,
  SkillCategory,
  SkillCategoryTranslationKey,
  SkillTab,
  SkillToolbarPlacement,
} from './constants';
import type { SkillToolbarPlacement as SkillToolbarPlacementType } from './constants';
import { InstalledSkillGrid } from './InstalledSkillGrid';
import { MarketplaceSkillGrid } from './MarketplaceSkillGrid';
import { SkillDocumentDialog } from './SkillDocumentDialog';
import { MarketplaceSkillDocumentDialog } from './MarketplaceSkillDocumentDialog';
import SkillSecurityReport from './SkillSecurityReport';
import { SkillsPageToolbar } from './SkillsPageToolbar';

type DirectImportSource = 'zip' | 'folder' | 'remote';

interface SkillsManagerProps {
  readOnly?: boolean;
  onCreateByChat?: () => void;
  onTrySkill?: (skillId: string) => void;
  toolbarPlacement?: SkillToolbarPlacementType;
  detailContainerRef?: React.RefObject<HTMLDivElement | null>;
}

const SkillsManager: React.FC<SkillsManagerProps> = ({
  readOnly,
  onCreateByChat,
  onTrySkill,
  toolbarPlacement = SkillToolbarPlacement.Inline,
  detailContainerRef,
}) => {
  const dispatch = useDispatch();
  const skills = useSelector((state: RootState) => state.skill.skills);

  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [skillDownloadSource, setSkillDownloadSource] = useState('');
  const [skillActionError, setSkillActionError] = useState('');
  const [isDownloadingSkill, setIsDownloadingSkill] = useState(false);
  const [isAddSkillMenuOpen, setIsAddSkillMenuOpen] = useState(false);
  const [isRemoteImportOpen, setIsRemoteImportOpen] = useState(false);
  const [isCategoryFilterOpen, setIsCategoryFilterOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SkillTab>(SkillTab.Installed);
  const [skillCategory, setSkillCategory] = useState<SkillCategory>(SkillCategory.All);
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [marketplacePageNumber, setMarketplacePageNumber] = useState(1);
  const [marketplaceHasMore, setMarketplaceHasMore] = useState(true);
  const [isLoadingMarketplace, setIsLoadingMarketplace] = useState(false);
  const [isLoadingMoreMarketplace, setIsLoadingMoreMarketplace] = useState(false);
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [installProgress, setInstallProgress] = useState(0);
  const [selectedMarketplaceSkill, setSelectedMarketplaceSkill] = useState<MarketplaceSkill | null>(
    null,
  );
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [selectedInstalledIds, setSelectedInstalledIds] = useState<Set<string>>(new Set());
  const [installedPageNumber, setInstalledPageNumber] = useState(1);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);
  const [skillsPendingDelete, setSkillsPendingDelete] = useState<Skill[]>([]);
  const [isDeletingSkill, setIsDeletingSkill] = useState(false);
  const [securityReport, setSecurityReport] = useState<SkillSecurityReportData | null>(null);
  const [pendingInstallId, setPendingInstallId] = useState<string | null>(null);
  const [pendingMarketplaceSkillId, setPendingMarketplaceSkillId] = useState<string | null>(null);
  const [pendingImportSource, setPendingImportSource] = useState<DirectImportSource | null>(null);
  const [isConfirmingInstall, setIsConfirmingInstall] = useState(false);

  const importInputRef = useRef<HTMLInputElement>(null);
  const marketplaceLoadedRef = useRef(false);
  const installedGridScrollRef = useRef<HTMLDivElement>(null);

  const refreshMarketplace = useCallback(async (forceRefresh = false) => {
    setIsLoadingMarketplace(true);
    try {
      const page = await skillService.fetchMarketplaceSkills({
        forceRefresh,
        pageNumber: 1,
        pageSize: SKILL_PAGE_SIZE,
      });
      setMarketplaceSkills(page.skills);
      setMarketplacePageNumber(1);
      setMarketplaceHasMore(page.hasMore);
      return page.skills;
    } finally {
      setIsLoadingMarketplace(false);
    }
  }, []);

  const loadMarketplacePage = useCallback(
    async (pageNumber: number) => {
      if (
        pageNumber < 1 ||
        isLoadingMarketplace ||
        isLoadingMoreMarketplace ||
        (pageNumber > marketplacePageNumber && !marketplaceHasMore)
      ) {
        return;
      }

      setIsLoadingMoreMarketplace(true);
      try {
        const page = await skillService.fetchMarketplaceSkills({
          pageNumber,
          pageSize: SKILL_PAGE_SIZE,
        });
        setMarketplaceSkills(page.skills);
        setMarketplacePageNumber(pageNumber);
        setMarketplaceHasMore(page.hasMore);
      } catch (error) {
        setSkillActionError(
          error instanceof Error ? error.message : i18nService.t('skillMarketplaceLoadFailed'),
        );
      } finally {
        setIsLoadingMoreMarketplace(false);
      }
    },
    [isLoadingMarketplace, isLoadingMoreMarketplace, marketplaceHasMore, marketplacePageNumber],
  );

  const showToast = (message: string) => {
    window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
  };

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

  useEffect(() => {
    if (activeTab !== SkillTab.Marketplace || marketplaceLoadedRef.current) return;
    marketplaceLoadedRef.current = true;
    refreshMarketplace(false).catch(() => {
      marketplaceLoadedRef.current = false;
    });
  }, [activeTab, refreshMarketplace]);

  useEffect(() => {
    setSelectedSkill(null);
    setSelectedMarketplaceSkill(null);
  }, [activeTab]);

  useEffect(() => {
    if (!isRemoteImportOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsRemoteImportOpen(false);
      }
    };

    document.addEventListener('keydown', handleEscape);
    setTimeout(() => importInputRef.current?.focus(), 0);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isRemoteImportOpen]);

  useEffect(() => {
    const hasOpenDialog = selectedSkill || selectedMarketplaceSkill;
    if (!hasOpenDialog) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (selectedSkill) setSelectedSkill(null);
        if (selectedMarketplaceSkill) setSelectedMarketplaceSkill(null);
      }
    };

    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [selectedSkill, selectedMarketplaceSkill]);

  // Map marketplace skill ID → name so installed skills use the same
  // display name as the marketplace listing.
  const marketplaceNameMap = useMemo(() => {
    const map = new Map<string, string>();
    marketplaceSkills.forEach(s => map.set(s.id, s.name));
    return map;
  }, [marketplaceSkills]);

  const resolveSkillName = useCallback(
    (id: string, fallback: string): string => marketplaceNameMap.get(id) || fallback,
    [marketplaceNameMap],
  );

  // The installed tab contains every locally installed skill. Enabled state
  // controls runtime availability, not whether the card is listed.
  const installedSkills = skills;
  const filteredInstalledSkills = useMemo(() => {
    const query = skillSearchQuery.trim().replace(/\s+/g, ' ').toLowerCase();
    return installedSkills.filter(skill => {
      const matchesCategory =
        skillCategory === SkillCategory.All || getSkillCategory(skill.id) === skillCategory;
      if (!matchesCategory || !query) return matchesCategory;
      return [
        skill.name,
        skill.displayName,
        skill.description,
        skill.displayDescription,
        skillService.getLocalizedSkillDescription(skill.id, skill.name, skill.description),
      ]
        .filter((value): value is string => Boolean(value))
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
  }, [installedSkills, skillCategory, skillSearchQuery]);
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
  }, [activeTab, skillCategory, skillSearchQuery]);

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
  const installedSkillIds = useMemo(() => new Set(skills.map(skill => skill.id)), [skills]);
  const installedSkillNames = useMemo(
    () =>
      new Set(
        skills.flatMap(skill =>
          [skill.name, skill.displayName]
            .filter((value): value is string => Boolean(value?.trim()))
            .map(value =>
              value
                .trim()
                .toLowerCase()
                .replace(/[\s_-]+/g, '-'),
            ),
        ),
      ),
    [skills],
  );

  const filteredMarketplaceSkills = useMemo(() => {
    const query = skillSearchQuery.trim().replace(/\s+/g, ' ').toLowerCase();
    let results = marketplaceSkills;
    if (query) {
      results = results.filter(skill => {
        return (
          skill.name.toLowerCase().includes(query) ||
          resolveLocalizedText(skill.description).toLowerCase().includes(query)
        );
      });
    }
    return results;
  }, [marketplaceSkills, skillSearchQuery]);

  const handleToggleSkill = async (skillId: string) => {
    const targetSkill = skills.find(skill => skill.id === skillId);
    if (!targetSkill) return;
    try {
      const updatedSkills = await skillService.setSkillEnabled(skillId, !targetSkill.enabled);
      dispatch(setSkills(updatedSkills));
      setSelectedSkill(current =>
        current?.id === skillId
          ? updatedSkills.find(skill => skill.id === skillId) || current
          : current,
      );
      setSkillActionError('');
    } catch (error) {
      setSkillActionError(
        error instanceof Error ? error.message : i18nService.t('skillUpdateFailed'),
      );
    }
  };

  const handleRequestDeleteSkill = (skill: Skill) => {
    if (skill.isBuiltIn) {
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: {
            message: i18nService.t('skillBuiltInCannotDelete'),
            isError: true,
          },
        }),
      );
      return;
    }
    setSkillActionError('');
    setSkillsPendingDelete([skill]);
  };

  const handleCancelDeleteSkill = () => {
    if (isDeletingSkill) return;
    setSkillsPendingDelete([]);
  };

  const handleConfirmDeleteSkill = async () => {
    if (skillsPendingDelete.length === 0 || isDeletingSkill) return;
    setIsDeletingSkill(true);
    setSkillActionError('');
    let latestSkills: Skill[] | undefined;
    try {
      for (const skill of skillsPendingDelete) {
        const result = await skillService.deleteSkill(skill.id);
        if (!result.success) {
          throw new Error(result.error || i18nService.t('skillDeleteFailed'));
        }
        latestSkills = result.skills;
      }
      if (latestSkills) {
        dispatch(setSkills(latestSkills));
      }
      if (selectedSkill && skillsPendingDelete.some(skill => skill.id === selectedSkill.id)) {
        setSelectedSkill(null);
      }
      setSelectedInstalledIds(current => {
        const deletedIds = new Set(skillsPendingDelete.map(skill => skill.id));
        return new Set([...current].filter(id => !deletedIds.has(id)));
      });
      window.dispatchEvent(
        new CustomEvent('app:showToast', {
          detail: { message: i18nService.t('skillDeleted'), isSuccess: true },
        }),
      );
      setSkillsPendingDelete([]);
    } catch (error) {
      setSkillActionError(
        error instanceof Error ? error.message : i18nService.t('skillDeleteFailed'),
      );
    } finally {
      setIsDeletingSkill(false);
    }
  };

  const handleAddSkillFromSource = async (source: string, sourceType: DirectImportSource) => {
    const trimmedSource = source.trim();
    if (!trimmedSource) return;
    setIsDownloadingSkill(true);
    setSkillActionError('');
    const result = await skillService.downloadSkill(trimmedSource);
    setIsDownloadingSkill(false);
    console.log(
      '[SkillsManager] downloadSkill result:',
      JSON.stringify({
        success: result.success,
        error: result.error,
        hasAuditReport: !!result.auditReport,
        pendingInstallId: result.pendingInstallId,
        riskLevel: result.auditReport?.riskLevel,
        findingsCount: result.auditReport?.findings?.length,
      }),
    );
    if (!result.success) {
      setSkillActionError(result.error || i18nService.t('skillDownloadFailed'));
      return;
    }
    // Security audit returned — show report modal
    if (result.auditReport && result.pendingInstallId) {
      setIsRemoteImportOpen(false);
      setSecurityReport(result.auditReport);
      setPendingInstallId(result.pendingInstallId);
      setPendingImportSource(sourceType);
      return;
    }
    if (result.skills) {
      dispatch(setSkills(result.skills));
    }
    showToast(i18nService.t('skillImportSuccess'));
    setSkillDownloadSource('');
    setIsAddSkillMenuOpen(false);
    setIsRemoteImportOpen(false);
  };

  const handleUploadSkillZip = async () => {
    if (isDownloadingSkill) return;
    const result = await window.electron.dialog.selectFile({
      title: i18nService.t('uploadSkillZip'),
      filters: [{ name: 'Zip', extensions: ['zip'] }],
    });
    if (result.success && result.path) {
      await handleAddSkillFromSource(result.path, 'zip');
    }
  };

  const handleUploadSkillFolder = async () => {
    if (isDownloadingSkill) return;
    const result = await window.electron.dialog.selectDirectory();
    if (result.success && result.path) {
      await handleAddSkillFromSource(result.path, 'folder');
    }
  };

  const handleOpenRemoteImport = () => {
    setIsAddSkillMenuOpen(false);
    setSkillActionError('');
    setSkillDownloadSource('');
    setIsRemoteImportOpen(true);
  };

  const handleCreateByChat = () => {
    setIsAddSkillMenuOpen(false);
    const skillCreator = skills.find(s => s.id === 'skill-creator');

    if (!skillCreator) {
      // Not installed → switch to marketplace tab and search
      setActiveTab(SkillTab.Marketplace);
      setSkillSearchQuery('skill-creator');
      window.dispatchEvent(
        new CustomEvent('app:showToast', { detail: i18nService.t('skillCreatorNotInstalled') }),
      );
      return;
    }

    if (!skillCreator.enabled) {
      // Installed but disabled → switch to the local installed view.
      setActiveTab(SkillTab.Installed);
      window.dispatchEvent(
        new CustomEvent('app:showToast', { detail: i18nService.t('skillCreatorNotEnabled') }),
      );
      return;
    }

    onCreateByChat?.();
  };

  const handleImportFromDialog = async () => {
    if (isDownloadingSkill) return;
    const trimmed = skillDownloadSource.trim();
    if (!trimmed) return;
    await handleAddSkillFromSource(trimmed, 'remote');
  };

  const getSkillInstallStatus = (
    marketplaceSkill: MarketplaceSkill,
  ): 'not_installed' | 'installed' => {
    const normalizedName = marketplaceSkill.name
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '-');
    const installed = skills.find(
      s =>
        s.id === marketplaceSkill.id ||
        s.name
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, '-') === normalizedName,
    );
    if (!installed) return 'not_installed';
    return 'installed';
  };

  const handleSelectMarketplaceSkill = (marketplaceSkill: MarketplaceSkill) => {
    const normalizedName = marketplaceSkill.name
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '-');
    const marketplaceLeafId = marketplaceSkill.id.split('/').pop()?.toLowerCase();
    const installedSkill = skills.find(
      skill =>
        skill.id === marketplaceSkill.id ||
        skill.id.toLowerCase() === marketplaceLeafId ||
        skill.name
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, '-') === normalizedName ||
        skill.displayName
          ?.trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, '-') === normalizedName,
    );
    if (installedSkill) {
      setSelectedMarketplaceSkill(null);
      setSelectedSkill(installedSkill);
      return;
    }
    setSelectedSkill(null);
    setSelectedMarketplaceSkill(marketplaceSkill);
  };

  const handleInstallMarketplaceSkill = async (skill: MarketplaceSkill) => {
    const installSource = skill.installSource;
    if (installingSkillId || !installSource) return;
    const normalizeSkillName = (value: string) =>
      value
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, '-');
    const requestedName = normalizeSkillName(skill.name);
    const alreadyInstalled = skills.some(
      localSkill =>
        localSkill.id === skill.id || normalizeSkillName(localSkill.name) === requestedName,
    );
    if (alreadyInstalled) {
      setSkillActionError(i18nService.t('skillAlreadyInstalled'));
      return;
    }
    setInstallingSkillId(skill.id);
    setInstallProgress(12);
    let awaitingSecurityConfirmation = false;
    const progressTimer = window.setInterval(() => {
      setInstallProgress(current => Math.min(88, current + 4));
    }, 700);
    setSkillActionError('');
    try {
      const result = await skillService.downloadSkill(installSource, {
        iconUrl: skill.iconUrl,
        displayName: skill.name,
      });
      if (!result.success) {
        setSkillActionError(result.error || i18nService.t('skillInstallFailed'));
        return;
      }
      // Security audit returned — show report modal
      if (result.auditReport && result.pendingInstallId) {
        awaitingSecurityConfirmation = true;
        setSecurityReport(result.auditReport);
        setPendingInstallId(result.pendingInstallId);
        setPendingMarketplaceSkillId(skill.id);
        setPendingImportSource(null);
        return;
      }
      if (result.skills) {
        dispatch(setSkills(result.skills));
        const normalizedMarketName = skill.name
          .trim()
          .toLowerCase()
          .replace(/[\s_-]+/g, '-');
        const marketLeafId = skill.id.split('/').pop()?.toLowerCase();
        const installedSkill = result.skills.find(
          localSkill =>
            localSkill.id === skill.id ||
            localSkill.id.toLowerCase() === marketLeafId ||
            localSkill.name
              .trim()
              .toLowerCase()
              .replace(/[\s_-]+/g, '-') === normalizedMarketName ||
            localSkill.displayName
              ?.trim()
              .toLowerCase()
              .replace(/[\s_-]+/g, '-') === normalizedMarketName,
        );
        if (installedSkill) {
          setSelectedMarketplaceSkill(null);
          setSelectedSkill(installedSkill);
        }
      }
    } catch {
      setSkillActionError(i18nService.t('skillInstallFailed'));
    } finally {
      window.clearInterval(progressTimer);
      setInstallProgress(100);
      window.setTimeout(
        () => {
          setInstallingSkillId(current => (current === skill.id ? null : current));
        },
        awaitingSecurityConfirmation ? 0 : 300,
      );
    }
  };

  const handleSecurityReportAction = async (action: 'install' | 'installDisabled' | 'cancel') => {
    if (action === 'cancel') {
      setSecurityReport(null);
      setPendingInstallId(null);
      setPendingMarketplaceSkillId(null);
      setPendingImportSource(null);
      setSkillActionError('');
      return;
    }
    if (!pendingInstallId) return;
    setIsConfirmingInstall(true);
    let shouldCloseSecurityReport = false;
    try {
      const result = await skillService.confirmInstall(pendingInstallId, action);
      if (result.success && result.skills) {
        dispatch(setSkills(result.skills));
        const installedSkill = pendingMarketplaceSkillId
          ? result.skills.find(skill => skill.id === pendingMarketplaceSkillId)
          : undefined;
        if (installedSkill) {
          setSelectedMarketplaceSkill(null);
          setSelectedSkill(installedSkill);
        }
        if (pendingImportSource) {
          showToast(i18nService.t('skillImportSuccess'));
        }
        shouldCloseSecurityReport = true;
      }
      if (!result.success && result.error) {
        setSkillActionError(result.error);
      }
    } catch {
      setSkillActionError(i18nService.t('skillInstallFailed'));
    } finally {
      if (shouldCloseSecurityReport) {
        setSecurityReport(null);
        setPendingInstallId(null);
        setPendingMarketplaceSkillId(null);
        setPendingImportSource(null);
      }
      setIsConfirmingInstall(false);
      setInstallingSkillId(null);
      if (shouldCloseSecurityReport) {
        setSkillDownloadSource('');
        setIsAddSkillMenuOpen(false);
        setIsRemoteImportOpen(false);
      }
    }
  };

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
            {i18nService.t(SkillCategoryTranslationKey[skillCategory])}
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
                  'w-full justify-start text-muted-foreground hover:bg-muted hover:text-foreground',
                  skillCategory === item && 'bg-muted text-foreground',
                )}
                onClick={() => {
                  setSkillCategory(item);
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
    <div className="flex h-full min-h-0 flex-col gap-4">
      {skillActionError && !isRemoteImportOpen && (
        <ErrorMessage message={skillActionError} onClose={() => setSkillActionError('')} />
      )}

      <div className="relative flex min-h-0 flex-1 flex-col gap-4">
        <div
          className={cn(
            'shrink-0',
            toolbarPlacement === SkillToolbarPlacement.ExpertHeader &&
              'absolute -top-10 right-0 z-10',
          )}
        >
          <SkillsPageToolbar
            activeTab={activeTab}
            installedCount={installedSkills.length}
            searchQuery={skillSearchQuery}
            isAddMenuOpen={isAddSkillMenuOpen}
            isDownloading={isDownloadingSkill}
            onTabChange={setActiveTab}
            onSearchQueryChange={setSkillSearchQuery}
            onClearSearch={() => setSkillSearchQuery('')}
            onAddMenuOpenChange={setIsAddSkillMenuOpen}
            onUploadZip={handleUploadSkillZip}
            onUploadFolder={handleUploadSkillFolder}
            onOpenRemoteImport={handleOpenRemoteImport}
            onCreateByChat={handleCreateByChat}
            onOpenMarketplace={() =>
              void window.electron.shell.openExternal('https://modelscope.cn/skills')
            }
          />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          {activeTab === SkillTab.Installed && (
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
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={readOnly}
                      onClick={() => setIsBatchMode(true)}
                    >
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setSelectedInstalledIds(
                            new Set(filteredInstalledSkills.map(skill => skill.id)),
                          )
                        }
                      >
                        {i18nService.t('skillSelectAll')}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setSelectedInstalledIds(new Set())}
                      >
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
                        onClick={() => batchToggleInstalled(true)}
                      >
                        {i18nService.t('skillBatchEnable')}
                      </Button>
                      <Button
                        className="min-w-16"
                        size="sm"
                        variant="outline"
                        disabled={readOnly || !selectedVisibleIds.size || isBatchUpdating}
                        onClick={() => batchToggleInstalled(false)}
                      >
                        {i18nService.t('skillBatchDisable')}
                      </Button>
                      <Button
                        className="min-w-16"
                        size="sm"
                        variant="outline"
                        disabled={readOnly || !selectedUninstallableIds.size || isBatchUpdating}
                        onClick={() => {
                          const selectedSkills = installedSkills.filter(skill =>
                            selectedUninstallableIds.has(skill.id),
                          );
                          if (selectedSkills.length > 0) setSkillsPendingDelete(selectedSkills);
                        }}
                      >
                        {i18nService.t('skillUninstall')}
                      </Button>
                      <Button
                        type="button"
                        className="ml-2"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsBatchMode(false);
                          setSelectedInstalledIds(new Set());
                        }}
                      >
                        {i18nService.t('cancel')}
                      </Button>
                    </div>
                  </>
                )}
              </div>
              <div
                ref={installedGridScrollRef}
                className="min-h-0 flex-1 overflow-y-auto scrollbar-gutter-stable"
              >
                <InstalledSkillGrid
                  skills={paginatedInstalledSkills}
                  readOnly={readOnly}
                  onSelect={setSelectedSkill}
                  onToggle={handleToggleSkill}
                  onTrySkill={onTrySkill}
                  resolveName={resolveSkillName}
                  selectedIds={isBatchMode ? selectedVisibleIds : new Set()}
                  onSelectToggle={toggleInstalledSelection}
                  batchMode={isBatchMode}
                />
              </div>
              <ListPagination
                page={installedPageNumber}
                totalPages={installedPageCount}
                className="shrink-0 py-4"
                onPageChange={setInstalledPageNumber}
              />
            </div>
          )}

          {activeTab === SkillTab.Marketplace &&
            (isLoadingMarketplace ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                {i18nService.t('loading')}
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col overflow-hidden">
                <div className="min-h-0 flex-1 overflow-y-auto pr-2 scrollbar-gutter-stable">
                  <MarketplaceSkillGrid
                    skills={filteredMarketplaceSkills}
                    installedSkillIds={installedSkillIds}
                    installedSkillNames={installedSkillNames}
                    isInstallingSkillId={installingSkillId}
                    readOnly={readOnly}
                    onSelect={handleSelectMarketplaceSkill}
                    onInstall={handleInstallMarketplaceSkill}
                    installProgress={installProgress}
                    isDetailOpen={Boolean(selectedMarketplaceSkill)}
                  />
                  {isLoadingMoreMarketplace && (
                    <div className="py-4 text-center text-sm text-muted-foreground">
                      {i18nService.t('loading')}
                    </div>
                  )}
                </div>
                <ListPagination
                  page={marketplacePageNumber}
                  hasNext={marketplaceHasMore}
                  disabled={isLoadingMoreMarketplace}
                  className="shrink-0 py-4"
                  onPageChange={page => void loadMarketplacePage(page)}
                />
              </div>
            ))}
        </div>
      </div>

      {selectedMarketplaceSkill &&
        (detailContainerRef?.current ? (
          createPortal(
            <MarketplaceSkillDocumentDialog
              skill={selectedMarketplaceSkill}
              readOnly={readOnly}
              isInstalling={installingSkillId === selectedMarketplaceSkill.id}
              isInstalled={getSkillInstallStatus(selectedMarketplaceSkill) === 'installed'}
              onClose={() => setSelectedMarketplaceSkill(null)}
              onInstall={handleInstallMarketplaceSkill}
            />,
            detailContainerRef.current,
          )
        ) : (
          <div className="absolute inset-0 z-10">
            <MarketplaceSkillDocumentDialog
              skill={selectedMarketplaceSkill}
              readOnly={readOnly}
              isInstalling={installingSkillId === selectedMarketplaceSkill.id}
              isInstalled={getSkillInstallStatus(selectedMarketplaceSkill) === 'installed'}
              onClose={() => setSelectedMarketplaceSkill(null)}
              onInstall={handleInstallMarketplaceSkill}
            />
          </div>
        ))}
      {selectedSkill &&
        (detailContainerRef?.current ? (
          createPortal(
            <SkillDocumentDialog
              skill={selectedSkill}
              readOnly={readOnly}
              onClose={() => setSelectedSkill(null)}
              onToggle={handleToggleSkill}
              onTrySkill={onTrySkill}
              onRequestDelete={handleRequestDeleteSkill}
            />,
            detailContainerRef.current,
          )
        ) : (
          <div className="absolute inset-0 z-10">
            <SkillDocumentDialog
              skill={selectedSkill}
              readOnly={readOnly}
              onClose={() => setSelectedSkill(null)}
              onToggle={handleToggleSkill}
              onTrySkill={onTrySkill}
              onRequestDelete={handleRequestDeleteSkill}
            />
          </div>
        ))}

      {skillsPendingDelete.length > 0 && (
        <DestructiveConfirmDialog
          open
          title={i18nService.t('deleteSkill')}
          description={
            skillsPendingDelete.length === 1
              ? i18nService.t('skillDeleteConfirm').replace('{name}', skillsPendingDelete[0].name)
              : i18nService
                  .t('skillBatchDeleteConfirm')
                  .replace('{count}', String(skillsPendingDelete.length))
          }
          cancelLabel={i18nService.t('cancel')}
          confirmLabel={i18nService.t('confirmDelete')}
          isConfirming={isDeletingSkill}
          onCancel={handleCancelDeleteSkill}
          onConfirm={handleConfirmDeleteSkill}
        />
      )}

      {isRemoteImportOpen &&
        createPortal(
          <Modal
            onClose={() => {
              setIsRemoteImportOpen(false);
              setSkillActionError('');
            }}
            overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            className="w-full max-w-md mx-4 rounded-2xl bg-surface border border-border shadow-2xl p-6"
          >
            <div className="flex items-start justify-between">
              <div className="text-lg font-semibold text-foreground">
                {i18nService.t('remoteImportTitle')}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => {
                  setIsRemoteImportOpen(false);
                  setSkillActionError('');
                }}
                className="rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-raised transition-colors"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                {i18nService.t('remoteSkillImportDescription')}
              </p>
              <div className="text-xs font-semibold tracking-wide text-muted-foreground">
                {i18nService.t('remoteSkillImportUrlLabel')}
              </div>
              <Input
                ref={importInputRef}
                type="text"
                value={skillDownloadSource}
                onChange={e => setSkillDownloadSource(e.target.value)}
                placeholder={i18nService.t('remoteSkillImportPlaceholder')}
                className="w-full px-3 py-2.5 text-sm rounded-xl bg-background text-foreground placeholder-secondary border border-border"
              />
              <p className="text-xs text-muted-foreground">
                {i18nService.t('remoteSkillImportExamples')}
              </p>
              {skillActionError && <div className="text-xs text-red-500">{skillActionError}</div>}
              <Button
                type="button"
                onClick={handleImportFromDialog}
                disabled={isDownloadingSkill || !skillDownloadSource.trim()}
                className="w-full py-2.5 text-primary-foreground text-sm font-medium transition-colors disabled:opacity-50"
              >
                {isDownloadingSkill
                  ? i18nService.t('importingSkill')
                  : i18nService.t('importSkill')}
              </Button>
            </div>
          </Modal>,
          document.body,
        )}

      {securityReport && (
        <SkillSecurityReport
          report={securityReport}
          onAction={handleSecurityReportAction}
          isLoading={isConfirmingInstall}
          error={skillActionError}
        />
      )}
    </div>
  );
};

export default SkillsManager;
