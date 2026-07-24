import { Button } from '@shared/components/ui/button';
import { DialogTitle } from '@shared/components/ui/dialog';
import { Input } from '@shared/components/ui/input';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { cn } from '@shared/lib/utils';
import { CheckCircle, Download, Link, Puzzle, X } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';

import type { SkillSecurityReport as SkillSecurityReportData } from '../../../main/libs/skillSecurity/skillSecurityTypes';
import { i18nService } from '../../services/i18n';
import { resolveLocalizedText, skillService } from '../../services/skill';
import { RootState } from '../../store';
import { setSkills } from '../../store/slices/skillSlice';
import { MarketplaceSkill, Skill } from '../../types/skill';
import Modal from '../common/Modal';
import ErrorMessage from '../ErrorMessage';
import { getSkillCategory, SkillCategory, SkillTab, SkillToolbarPlacement } from './constants';
import type { SkillToolbarPlacement as SkillToolbarPlacementType } from './constants';
import { InstalledSkillGrid } from './InstalledSkillGrid';
import { MarketplaceSkillGrid } from './MarketplaceSkillGrid';
import { SkillDocumentDialog } from './SkillDocumentDialog';
import SkillSecurityReport from './SkillSecurityReport';
import { SkillsPageToolbar } from './SkillsPageToolbar';

type DirectImportSource = 'zip' | 'folder' | 'remote';

const MARKETPLACE_INITIAL_PAGE_SIZE = 24;
const MARKETPLACE_LOAD_PAGE_SIZE = 8;
const MARKETPLACE_NEXT_PAGE_NUMBER = MARKETPLACE_INITIAL_PAGE_SIZE / MARKETPLACE_LOAD_PAGE_SIZE + 1;
const MARKETPLACE_LOAD_THRESHOLD = 160;

interface SkillsManagerProps {
  readOnly?: boolean;
  onCreateByChat?: () => void;
  onTrySkill?: (skillId: string) => void;
  toolbarPlacement?: SkillToolbarPlacementType;
}

const SkillsManager: React.FC<SkillsManagerProps> = ({
  readOnly,
  onCreateByChat,
  onTrySkill,
  toolbarPlacement = SkillToolbarPlacement.Inline,
}) => {
  const dispatch = useDispatch();
  const skills = useSelector((state: RootState) => state.skill.skills);

  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [skillDownloadSource, setSkillDownloadSource] = useState('');
  const [skillActionError, setSkillActionError] = useState('');
  const [isDownloadingSkill, setIsDownloadingSkill] = useState(false);
  const [isAddSkillMenuOpen, setIsAddSkillMenuOpen] = useState(false);
  const [isRemoteImportOpen, setIsRemoteImportOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SkillTab>(SkillTab.Installed);
  const [skillCategory, setSkillCategory] = useState<SkillCategory>(SkillCategory.All);
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [marketplaceNextPageNumber, setMarketplaceNextPageNumber] = useState(
    MARKETPLACE_NEXT_PAGE_NUMBER,
  );
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
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [selectedSkillContent, setSelectedSkillContent] = useState('');
  const [isLoadingSkillContent, setIsLoadingSkillContent] = useState(false);
  const [skillPendingDelete, setSkillPendingDelete] = useState<Skill | null>(null);
  const [isDeletingSkill, setIsDeletingSkill] = useState(false);
  const [securityReport, setSecurityReport] = useState<SkillSecurityReportData | null>(null);
  const [pendingInstallId, setPendingInstallId] = useState<string | null>(null);
  const [pendingImportSource, setPendingImportSource] = useState<DirectImportSource | null>(null);
  const [isConfirmingInstall, setIsConfirmingInstall] = useState(false);

  const importInputRef = useRef<HTMLInputElement>(null);
  const marketplaceContentRef = useRef<HTMLDivElement>(null);
  const isLoadingMoreMarketplaceRef = useRef(false);

  const refreshMarketplace = useCallback(async (forceRefresh = false) => {
    setIsLoadingMarketplace(true);
    try {
      const page = await skillService.fetchMarketplaceSkills({
        forceRefresh,
        pageNumber: 1,
        pageSize: MARKETPLACE_INITIAL_PAGE_SIZE,
      });
      setMarketplaceSkills(page.skills);
      setMarketplaceNextPageNumber(MARKETPLACE_NEXT_PAGE_NUMBER);
      setMarketplaceHasMore(page.hasMore);
      return page.skills;
    } finally {
      setIsLoadingMarketplace(false);
    }
  }, []);

  const loadNextMarketplacePage = useCallback(async () => {
    if (!marketplaceHasMore || isLoadingMarketplace || isLoadingMoreMarketplaceRef.current) {
      return;
    }

    isLoadingMoreMarketplaceRef.current = true;
    setIsLoadingMoreMarketplace(true);
    try {
      const page = await skillService.fetchMarketplaceSkills({
        pageNumber: marketplaceNextPageNumber,
        pageSize: MARKETPLACE_LOAD_PAGE_SIZE,
      });
      setMarketplaceSkills(current => {
        const existingIds = new Set(current.map(skill => skill.id));
        return [...current, ...page.skills.filter(skill => !existingIds.has(skill.id))];
      });
      setMarketplaceNextPageNumber(current => current + 1);
      setMarketplaceHasMore(page.hasMore);
    } finally {
      isLoadingMoreMarketplaceRef.current = false;
      setIsLoadingMoreMarketplace(false);
    }
  }, [isLoadingMarketplace, marketplaceHasMore, marketplaceNextPageNumber]);

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
    refreshMarketplace(false).catch(() => undefined);
  }, [refreshMarketplace]);

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
  const filteredInstalledSkills = useMemo(
    () =>
      skillCategory === SkillCategory.All
        ? installedSkills
        : installedSkills.filter(skill => getSkillCategory(skill.id) === skillCategory),
    [installedSkills, skillCategory],
  );
  const toggleInstalledSelection = (skillId: string) => {
    setSelectedInstalledIds(current => {
      const next = new Set(current);
      if (next.has(skillId)) next.delete(skillId);
      else next.add(skillId);
      return next;
    });
  };
  const batchToggleInstalled = async (enabled: boolean) => {
    for (const id of selectedInstalledIds) {
      const skill = skills.find(item => item.id === id);
      if (skill && skill.enabled !== enabled) await skillService.setSkillEnabled(id, enabled);
    }
    const result = await window.electron.skills.list();
    if (result.success && result.skills) dispatch(setSkills(result.skills));
  };
  const installedSkillIds = useMemo(() => new Set(skills.map(skill => skill.id)), [skills]);
  const installedSkillNames = useMemo(
    () =>
      new Set(
        skills.map(skill =>
          skill.name
            .trim()
            .toLowerCase()
            .replace(/[\s_-]+/g, '-'),
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

  const handleMarketplaceScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const { clientHeight, scrollHeight, scrollTop } = event.currentTarget;
    if (scrollHeight - scrollTop - clientHeight <= MARKETPLACE_LOAD_THRESHOLD) {
      void loadNextMarketplacePage();
    }
  };

  const handleToggleSkill = async (skillId: string) => {
    const targetSkill = skills.find(skill => skill.id === skillId);
    if (!targetSkill) return;
    try {
      const updatedSkills = await skillService.setSkillEnabled(skillId, !targetSkill.enabled);
      dispatch(setSkills(updatedSkills));
      setSkillActionError('');
    } catch (error) {
      setSkillActionError(
        error instanceof Error ? error.message : i18nService.t('skillUpdateFailed'),
      );
    }
  };

  useEffect(() => {
    if (!selectedSkill || activeTab !== SkillTab.Installed) {
      setSelectedSkillContent('');
      return;
    }

    let cancelled = false;
    setIsLoadingSkillContent(true);
    window.electron.skills
      .getContent(selectedSkill.id)
      .then(result => {
        if (!cancelled && result.success) {
          setSelectedSkillContent(result.content || '');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingSkillContent(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeTab, selectedSkill]);

  const handleToggleSkillPin = async (skillId: string) => {
    const targetSkill = skills.find(skill => skill.id === skillId);
    if (!targetSkill) return;
    try {
      const updatedSkills = await skillService.setSkillPinned(skillId, !targetSkill.pinned);
      dispatch(setSkills(updatedSkills));
      setSkillActionError('');
    } catch (error) {
      setSkillActionError(
        error instanceof Error ? error.message : i18nService.t('skillUpdateFailed'),
      );
    }
  };

  const handleRequestDeleteSkill = (skill: Skill) => {
    if (skill.isBuiltIn) {
      setSkillActionError(i18nService.t('skillBuiltInCannotDelete'));
      return;
    }
    setSkillActionError('');
    setSkillPendingDelete(skill);
  };

  const handleUninstallSkill = async (skill: Skill) => {
    if (skill.isBuiltIn) {
      await handleToggleSkill(skill.id);
      return;
    }
    handleRequestDeleteSkill(skill);
  };

  const handleCancelDeleteSkill = () => {
    if (isDeletingSkill) return;
    setSkillPendingDelete(null);
  };

  const handleConfirmDeleteSkill = async () => {
    if (!skillPendingDelete || isDeletingSkill) return;
    setIsDeletingSkill(true);
    setSkillActionError('');
    const result = await skillService.deleteSkill(skillPendingDelete.id);
    if (!result.success) {
      setSkillActionError(result.error || i18nService.t('skillDeleteFailed'));
      setIsDeletingSkill(false);
      return;
    }
    if (result.skills) {
      dispatch(setSkills(result.skills));
    }
    setIsDeletingSkill(false);
    setSkillPendingDelete(null);
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

    try {
      new URL(trimmed);
    } catch {
      // Not a URL (e.g. "owner/repo" shorthand for GitHub) — only allow on GitHub tab
      // Allow non-URL sources such as owner/repo and npm package specs.
    }

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
      const result = await skillService.downloadSkill(installSource);
      if (!result.success) {
        setSkillActionError(result.error || i18nService.t('skillInstallFailed'));
        return;
      }
      // Security audit returned — show report modal
      if (result.auditReport && result.pendingInstallId) {
        awaitingSecurityConfirmation = true;
        setSecurityReport(result.auditReport);
        setPendingInstallId(result.pendingInstallId);
        setPendingImportSource(null);
        return;
      }
      if (result.skills) {
        dispatch(setSkills(result.skills));
      }
    } catch {
      setSkillActionError(i18nService.t('skillInstallFailed'));
    } finally {
      window.clearInterval(progressTimer);
      setInstallProgress(100);
      if (!awaitingSecurityConfirmation) setInstallingSkillId(null);
    }
  };

  const handleSecurityReportAction = async (action: 'install' | 'installDisabled' | 'cancel') => {
    if (action === 'cancel') {
      setSecurityReport(null);
      setPendingInstallId(null);
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
            category={skillCategory}
            onCategoryChange={setSkillCategory}
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
          />
        </div>
        <div className="min-h-0 flex-1 overflow-hidden pt-2">
          {activeTab === SkillTab.Installed && (
            <div className="h-full overflow-y-auto">
              <div
                className={cn(
                  'mb-4 flex w-full min-h-9 flex-wrap items-center gap-3 px-1 text-sm text-muted-foreground',
                  isBatchMode ? 'justify-between' : 'justify-end',
                )}
              >
                {!isBatchMode ? (
                  <Button size="sm" variant="ghost" onClick={() => setIsBatchMode(true)}>
                    {i18nService.t('skillBatchManage')}
                  </Button>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <span>
                        {i18nService
                          .t('skillBatchSelected')
                          .replace('{count}', String(selectedInstalledIds.size))}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setSelectedInstalledIds(new Set(installedSkills.map(skill => skill.id)))
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
                      <Button
                        className="min-w-16"
                        size="sm"
                        variant="outline"
                        disabled={!selectedInstalledIds.size}
                        onClick={() => batchToggleInstalled(true)}
                      >
                        {i18nService.t('skillBatchEnable')}
                      </Button>
                      <Button
                        className="min-w-16"
                        size="sm"
                        variant="outline"
                        disabled={!selectedInstalledIds.size}
                        onClick={() => batchToggleInstalled(false)}
                      >
                        {i18nService.t('skillBatchDisable')}
                      </Button>
                      <Button
                        className="min-w-16"
                        size="sm"
                        variant="outline"
                        disabled={!selectedInstalledIds.size}
                        onClick={() => {
                          selectedInstalledIds.forEach(id => {
                            const skill = installedSkills.find(item => item.id === id);
                            if (skill && !skill.isBuiltIn) void handleUninstallSkill(skill);
                          });
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
              <InstalledSkillGrid
                skills={filteredInstalledSkills}
                readOnly={readOnly}
                onSelect={setSelectedSkill}
                onToggle={handleToggleSkill}
                onUninstall={handleUninstallSkill}
                onTogglePin={handleToggleSkillPin}
                onTrySkill={onTrySkill}
                resolveName={resolveSkillName}
                selectedIds={isBatchMode ? selectedInstalledIds : new Set()}
                onSelectToggle={toggleInstalledSelection}
                batchMode={isBatchMode}
              />
            </div>
          )}

          {activeTab === SkillTab.Marketplace &&
            (isLoadingMarketplace ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                {i18nService.t('downloadingSkill')}
              </div>
            ) : (
              <div className="flex h-full min-h-0 flex-col">
                <div className="mb-1 flex shrink-0 items-start gap-3 pb-2">
                  <div className="min-w-0">
                    <h3 className="text-base font-semibold leading-snug">
                      {i18nService.t('skillMarketplace')}
                    </h3>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2"
                      onClick={() =>
                        void window.electron.shell.openExternal('https://modelscope.cn/skills')
                      }
                    >
                      <Link data-icon="inline-start" />
                      {i18nService.t('skillMarketplaceOpenExternal')}
                    </Button>
                  </div>
                </div>
                <div
                  ref={marketplaceContentRef}
                  className="min-h-0 flex-1 overflow-y-auto pr-2"
                  onScroll={handleMarketplaceScroll}
                >
                  <MarketplaceSkillGrid
                    skills={filteredMarketplaceSkills}
                    installedSkillIds={installedSkillIds}
                    installedSkillNames={installedSkillNames}
                    isInstallingSkillId={installingSkillId}
                    readOnly={readOnly}
                    onSelect={setSelectedMarketplaceSkill}
                    onInstall={handleInstallMarketplaceSkill}
                    installProgress={installProgress}
                  />
                  {isLoadingMoreMarketplace && (
                    <div className="py-4 text-center text-sm text-muted-foreground">
                      {i18nService.t('downloadingSkill')}
                    </div>
                  )}
                </div>
              </div>
            ))}
        </div>
      </div>

      {selectedMarketplaceSkill &&
        createPortal(
          <Modal
            onClose={() => setSelectedMarketplaceSkill(null)}
            overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            className="flex max-h-[calc(100dvh-3rem)] w-full max-w-md flex-col gap-0 rounded-xl border border-border bg-surface p-0 shadow-xl sm:max-w-md"
          >
            <div className="flex shrink-0 items-start justify-between px-6 pt-6">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background">
                  <Puzzle className="size-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="truncate text-base font-semibold text-foreground">
                    {selectedMarketplaceSkill.name}
                  </DialogTitle>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setSelectedMarketplaceSkill(null)}
                className="rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-raised transition-colors shrink-0"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-6">
              <div className="flex min-w-0 flex-col gap-4 py-4">
                <p className="break-words text-sm text-muted-foreground">
                  {resolveLocalizedText(selectedMarketplaceSkill.description)}
                </p>

                <div className="flex flex-col gap-2">
                  {selectedMarketplaceSkill.version && (
                    <div className="flex min-w-0 items-center gap-2 text-xs">
                      <span className="w-16 shrink-0 text-muted-foreground">
                        {i18nService.t('skillDetailVersion')}
                      </span>
                      <span className="min-w-0 break-words rounded bg-surface-raised px-1.5 py-0.5 font-medium text-foreground">
                        v{selectedMarketplaceSkill.version}
                      </span>
                    </div>
                  )}
                  {selectedMarketplaceSkill.source?.from && (
                    <div className="flex min-w-0 items-start gap-2 text-xs">
                      <span className="w-16 shrink-0 pt-0.5 text-muted-foreground">
                        {i18nService.t('skillDetailSource')}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                        <span className="break-words rounded bg-surface-raised px-1.5 py-0.5 font-medium text-foreground">
                          {selectedMarketplaceSkill.source.from}
                        </span>
                        {selectedMarketplaceSkill.source.author && (
                          <span className="break-words rounded bg-surface-raised px-1.5 py-0.5 font-medium text-foreground">
                            {selectedMarketplaceSkill.source.author}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  {selectedMarketplaceSkill.source?.url && (
                    <div className="flex min-w-0 items-start gap-2 text-xs">
                      <span className="w-16 shrink-0 pt-0.5 text-muted-foreground">URL</span>
                      <Button
                        type="button"
                        variant="link"
                        className="h-auto min-w-0 flex-1 justify-start break-all whitespace-normal px-0 text-left text-primary hover:underline"
                        onClick={e => {
                          e.stopPropagation();
                          window.electron.shell.openExternal(selectedMarketplaceSkill.source.url);
                        }}
                      >
                        {selectedMarketplaceSkill.source.url}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>

            <div className="shrink-0 border-t border-border px-6 pb-6 pt-4">
              {(() => {
                const status = getSkillInstallStatus(selectedMarketplaceSkill);
                if (status === 'installed') {
                  return (
                    <div className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-green-500/10 text-green-600 dark:text-green-400 text-sm font-medium">
                      <CheckCircle className="h-4 w-4" />
                      {i18nService.t('skillAlreadyInstalled')}
                    </div>
                  );
                }
                return !readOnly && selectedMarketplaceSkill.installSource ? (
                  <Button
                    type="button"
                    onClick={() => handleInstallMarketplaceSkill(selectedMarketplaceSkill)}
                    disabled={installingSkillId !== null}
                    className="w-full py-2.5 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                  >
                    <Download className="h-4 w-4" />
                    {installingSkillId === selectedMarketplaceSkill.id
                      ? i18nService.t('skillInstalling')
                      : i18nService.t('skillInstall')}
                  </Button>
                ) : null;
              })()}
            </div>
          </Modal>,
          document.body,
        )}

      {selectedSkill &&
        createPortal(
          <SkillDocumentDialog
            skill={selectedSkill}
            content={selectedSkillContent}
            isLoading={isLoadingSkillContent}
            onClose={() => setSelectedSkill(null)}
          />,
          document.body,
        )}

      {skillPendingDelete &&
        createPortal(
          <Modal
            onClose={handleCancelDeleteSkill}
            overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            className="w-full max-w-sm mx-4 rounded-2xl bg-surface border border-border shadow-2xl p-5"
          >
            <div className="text-lg font-semibold text-foreground">
              {i18nService.t('deleteSkill')}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {i18nService.t('skillDeleteConfirm').replace('{name}', skillPendingDelete.name)}
            </p>
            {skillActionError && (
              <div className="mt-3 text-xs text-red-500">{skillActionError}</div>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCancelDeleteSkill}
                disabled={isDeletingSkill}
                className="px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {i18nService.t('cancel')}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={handleConfirmDeleteSkill}
                disabled={isDeletingSkill}
                className="px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {i18nService.t('confirmDelete')}
              </Button>
            </div>
          </Modal>,
          document.body,
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
                className="w-full py-2.5 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-50"
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
