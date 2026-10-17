import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import { cn } from '@shared/lib/utils';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch } from 'react-redux';

import { i18nService } from '../../services/i18n';
import { resolveLocalizedText, skillService } from '../../services/skill';
import { setSkills } from '../../store/slices/skillSlice';
import { MarketplaceSkill, Skill } from '../../types/skill';
import ErrorMessage from '../ErrorMessage';
import { ListPagination } from '../common/ListPagination';
import { SkillCategory, SkillTab, SkillToolbarPlacement } from './constants';
import type { SkillToolbarPlacement as SkillToolbarPlacementType } from './constants';
import { MarketplaceSkillGrid } from './MarketplaceSkillGrid';
import { SkillDocumentDialog } from './SkillDocumentDialog';
import { MarketplaceSkillDocumentDialog } from './MarketplaceSkillDocumentDialog';
import SkillSecurityReport from './SkillSecurityReport';
import { SkillsPageToolbar } from './SkillsPageToolbar';
import { useMarketplaceSearchPool } from './useMarketplaceSearchPool';
import { InstalledSkillsPanel } from './manager/InstalledSkillsPanel';
import { RemoteImportModal } from './manager/RemoteImportModal';
import {
  buildInstalledSkillNames,
  buildMarketplaceNameMap,
  findInstalledSkillForMarketplace,
  isMarketplaceSkillInstalled,
} from './manager/skillMatching';
import type { DirectImportSource } from './manager/types';
import { useInstalledSkillList } from './manager/useInstalledSkillList';
import { useMarketplaceCatalog } from './manager/useMarketplaceCatalog';
import { useSkillInstallFlow } from './manager/useSkillInstallFlow';

interface SkillsManagerProps {
  readOnly?: boolean;
  onCreateByChat?: () => void;
  onTrySkill?: (skillId: string) => void;
  toolbarPlacement?: SkillToolbarPlacementType;
  detailContainerRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * Skills page orchestrator. Owns the shared page state (active tab, search,
 * dialogs, direct imports, deletes) and wires the installed-tab list state
 * (useInstalledSkillList), the marketplace catalog (useMarketplaceCatalog)
 * and the install/security flow (useSkillInstallFlow) into the tab views.
 */
const SkillsManager: React.FC<SkillsManagerProps> = ({
  readOnly,
  onCreateByChat,
  onTrySkill,
  toolbarPlacement = SkillToolbarPlacement.Inline,
  detailContainerRef,
}) => {
  const dispatch = useDispatch();

  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [skillDownloadSource, setSkillDownloadSource] = useState('');
  const [skillActionError, setSkillActionError] = useState('');
  const [isDownloadingSkill, setIsDownloadingSkill] = useState(false);
  const [isAddSkillMenuOpen, setIsAddSkillMenuOpen] = useState(false);
  const [isRemoteImportOpen, setIsRemoteImportOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SkillTab>(SkillTab.Installed);
  const [skillCategory, setSkillCategory] = useState<SkillCategory>(SkillCategory.All);
  const [selectedMarketplaceSkill, setSelectedMarketplaceSkill] = useState<MarketplaceSkill | null>(
    null,
  );
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [skillsPendingDelete, setSkillsPendingDelete] = useState<Skill[]>([]);
  const [isDeletingSkill, setIsDeletingSkill] = useState(false);

  const importInputRef = useRef<HTMLInputElement>(null);

  const showToast = (message: string) => {
    window.dispatchEvent(new CustomEvent('app:showToast', { detail: message }));
  };

  const {
    installedSkills,
    filteredInstalledSkills,
    paginatedInstalledSkills,
    installedPageNumber,
    setInstalledPageNumber,
    installedPageCount,
    installedGridScrollRef,
    selectedVisibleIds,
    selectedUninstallableIds,
    setSelectedInstalledIds,
    toggleInstalledSelection,
    isBatchMode,
    setIsBatchMode,
    isBatchUpdating,
    batchToggleInstalled,
  } = useInstalledSkillList({
    activeTab,
    skillCategory,
    searchQuery: skillSearchQuery,
    setSkillActionError,
    showToast,
  });

  const {
    marketplaceSkills,
    marketplacePageNumber,
    marketplaceHasMore,
    isLoadingMarketplace,
    isLoadingMoreMarketplace,
    loadMarketplacePage,
  } = useMarketplaceCatalog({ activeTab, setSkillActionError });

  const { searchPool, isLoadingSearchPool } = useMarketplaceSearchPool(activeTab, skillSearchQuery);

  const {
    installingSkillId,
    installProgress,
    securityReport,
    isConfirmingInstall,
    openDirectImportSecurityReview,
    handleInstallMarketplaceSkill,
    handleSecurityReportAction,
  } = useSkillInstallFlow({
    installedSkills,
    setSkillActionError,
    showToast,
    setSelectedSkill,
    setSelectedMarketplaceSkill,
    onInstallConfirmed: () => {
      setSkillDownloadSource('');
      setIsAddSkillMenuOpen(false);
      setIsRemoteImportOpen(false);
    },
  });

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
  const marketplaceNameMap = useMemo(
    () => buildMarketplaceNameMap(marketplaceSkills),
    [marketplaceSkills],
  );

  const resolveSkillName = useCallback(
    (id: string, fallback: string): string => marketplaceNameMap.get(id) || fallback,
    [marketplaceNameMap],
  );

  const installedSkillIds = useMemo(
    () => new Set(installedSkills.map(skill => skill.id)),
    [installedSkills],
  );
  const installedSkillNames = useMemo(
    () => buildInstalledSkillNames(installedSkills),
    [installedSkills],
  );

  const filteredMarketplaceSkills = useMemo(() => {
    const query = skillSearchQuery.trim().replace(/\s+/g, ' ').toLowerCase();
    // A query loads a bounded window of pages (see useMarketplaceSearchPool),
    // because the listing is paged server side.
    const sourceSkills =
      query && searchPool && searchPool.length > 0 ? searchPool : marketplaceSkills;
    let results = sourceSkills;
    if (query) {
      results = results.filter(skill => {
        return (
          skill.name.toLowerCase().includes(query) ||
          resolveLocalizedText(skill.description).toLowerCase().includes(query)
        );
      });
    }
    return results;
  }, [marketplaceSkills, searchPool, skillSearchQuery]);

  const handleToggleSkill = async (skillId: string) => {
    const targetSkill = installedSkills.find(skill => skill.id === skillId);
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
    const deletedSkillIds = new Set<string>();
    try {
      for (const skill of skillsPendingDelete) {
        const result = await skillService.deleteSkill(skill.id);
        if (!result.success) {
          throw new Error(result.error || i18nService.t('skillDeleteFailed'));
        }
        deletedSkillIds.add(skill.id);
        // Publish every successful deletion right away: a later failure must
        // never leave an already-removed skill listed as installed.
        if (result.skills) {
          dispatch(setSkills(result.skills));
        }
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
      // Keep the pending list actionable, otherwise retrying would try to
      // delete skills that are already gone and fail on the first one.
      if (deletedSkillIds.size > 0) {
        setSkillsPendingDelete(current => current.filter(skill => !deletedSkillIds.has(skill.id)));
        setSelectedInstalledIds(
          current => new Set([...current].filter(id => !deletedSkillIds.has(id))),
        );
      }
    } finally {
      setIsDeletingSkill(false);
    }
  };

  const handleBatchUninstall = () => {
    const selectedSkills = installedSkills.filter(skill => selectedUninstallableIds.has(skill.id));
    if (selectedSkills.length > 0) setSkillsPendingDelete(selectedSkills);
  };

  const handleClearInstalledFilters = () => {
    setSkillSearchQuery('');
    setSkillCategory(SkillCategory.All);
  };

  const handleAddSkillFromSource = async (source: string, sourceType: DirectImportSource) => {
    const trimmedSource = source.trim();
    if (!trimmedSource) return;
    setIsDownloadingSkill(true);
    setSkillActionError('');
    const result = await skillService.downloadSkill(trimmedSource);
    setIsDownloadingSkill(false);
    if (!result.success) {
      setSkillActionError(result.error || i18nService.t('skillDownloadFailed'));
      return;
    }
    // Security audit returned — show report modal
    if (result.auditReport && result.pendingInstallId) {
      setIsRemoteImportOpen(false);
      openDirectImportSecurityReview(result.auditReport, result.pendingInstallId, sourceType);
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
    const skillCreator = installedSkills.find(s => s.id === 'skill-creator');

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

  const handleSelectMarketplaceSkill = (marketplaceSkill: MarketplaceSkill) => {
    const installedSkill = findInstalledSkillForMarketplace(installedSkills, marketplaceSkill);
    if (installedSkill) {
      setSelectedMarketplaceSkill(null);
      setSelectedSkill(installedSkill);
      return;
    }
    setSelectedSkill(null);
    setSelectedMarketplaceSkill(marketplaceSkill);
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
            <InstalledSkillsPanel
              readOnly={readOnly}
              installedSkills={installedSkills}
              filteredSkills={filteredInstalledSkills}
              paginatedSkills={paginatedInstalledSkills}
              pageNumber={installedPageNumber}
              pageCount={installedPageCount}
              onPageChange={setInstalledPageNumber}
              gridScrollRef={installedGridScrollRef}
              category={skillCategory}
              onCategoryChange={setSkillCategory}
              isBatchMode={isBatchMode}
              isBatchUpdating={isBatchUpdating}
              selectedVisibleIds={selectedVisibleIds}
              selectedUninstallableIds={selectedUninstallableIds}
              onEnterBatchMode={() => setIsBatchMode(true)}
              onExitBatchMode={() => {
                setIsBatchMode(false);
                setSelectedInstalledIds(new Set());
              }}
              onSelectAll={() =>
                setSelectedInstalledIds(new Set(filteredInstalledSkills.map(skill => skill.id)))
              }
              onClearSelection={() => setSelectedInstalledIds(new Set())}
              onToggleSelection={toggleInstalledSelection}
              onBatchToggle={batchToggleInstalled}
              onBatchUninstall={handleBatchUninstall}
              onClearFilters={handleClearInstalledFilters}
              onSelectSkill={setSelectedSkill}
              onToggleSkill={handleToggleSkill}
              onTrySkill={onTrySkill}
              resolveName={resolveSkillName}
            />
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
                    searchQuery={skillSearchQuery}
                    isSearching={isLoadingSearchPool}
                    onClearSearch={() => setSkillSearchQuery('')}
                  />
                  {isLoadingMoreMarketplace && (
                    <div className="py-4 text-center text-sm text-muted-foreground">
                      {i18nService.t('loading')}
                    </div>
                  )}
                </div>
                {!skillSearchQuery.trim() && (
                  <ListPagination
                    page={marketplacePageNumber}
                    hasNext={marketplaceHasMore}
                    disabled={isLoadingMoreMarketplace}
                    className="shrink-0 py-4"
                    onPageChange={page => void loadMarketplacePage(page)}
                  />
                )}
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
              isInstalled={isMarketplaceSkillInstalled(installedSkills, selectedMarketplaceSkill)}
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
              isInstalled={isMarketplaceSkillInstalled(installedSkills, selectedMarketplaceSkill)}
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

      <RemoteImportModal
        open={isRemoteImportOpen}
        inputRef={importInputRef}
        source={skillDownloadSource}
        onSourceChange={setSkillDownloadSource}
        isDownloading={isDownloadingSkill}
        error={skillActionError}
        onSubmit={handleImportFromDialog}
        onClose={() => {
          setIsRemoteImportOpen(false);
          setSkillActionError('');
        }}
      />

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
