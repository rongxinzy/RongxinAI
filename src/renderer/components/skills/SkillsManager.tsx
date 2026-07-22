import { Button } from '@shared/components/ui/button';
import { Card, CardContent } from '@shared/components/ui/card';
import { DialogTitle } from '@shared/components/ui/dialog';
import { Input } from '@shared/components/ui/input';
import { ScrollArea } from '@shared/components/ui/scroll-area';
import { Separator } from '@shared/components/ui/separator';
import { Switch } from '@shared/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import { cn } from '@shared/lib/utils';
import {
  CheckCircle,
  Download,
  FolderOpen,
  Link,
  Pencil,
  PlusCircle,
  Puzzle,
  Search,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react';
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
import SkillSecurityReport from './SkillSecurityReport';

type SkillTab = 'installed' | 'marketplace';
type DirectImportSource = 'zip' | 'folder' | 'remote';

const MARKETPLACE_MIN_PAGE_SIZE = 1;
const MARKETPLACE_MAX_PAGE_SIZE = 40;
const MARKETPLACE_DEFAULT_PAGE_SIZE = 20;
const MARKETPLACE_PAGE_WINDOW = 2;

type MarketplacePageItem = number | 'ellipsis-left' | 'ellipsis-right';

const getMarketplaceColumnCount = () => {
  if (typeof window === 'undefined') return 1;

  if (window.innerWidth >= 1280) return 3;
  if (window.innerWidth >= 768) return 2;
  return 1;
};

const estimateMarketplacePageSize = () => {
  if (typeof window === 'undefined') {
    return MARKETPLACE_DEFAULT_PAGE_SIZE;
  }

  const columns = getMarketplaceColumnCount();
  const availableHeight = Math.max(280, window.innerHeight - 320);
  const rows = Math.max(2, Math.floor(availableHeight / 132));
  const pageSize = columns * rows;

  return Math.min(MARKETPLACE_MAX_PAGE_SIZE, Math.max(MARKETPLACE_MIN_PAGE_SIZE, pageSize));
};

const getMarketplacePageItems = (currentPage: number, pageCount: number): MarketplacePageItem[] => {
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, pageCount]);
  const start = Math.max(2, currentPage - MARKETPLACE_PAGE_WINDOW);
  const end = Math.min(pageCount - 1, currentPage + MARKETPLACE_PAGE_WINDOW);

  for (let page = start; page <= end; page++) {
    pages.add(page);
  }

  const sortedPages = Array.from(pages).sort((a, b) => a - b);
  const items: MarketplacePageItem[] = [];

  for (const page of sortedPages) {
    const previous = items[items.length - 1];
    if (typeof previous === 'number' && page - previous > 1) {
      items.push(previous === 1 ? 'ellipsis-left' : 'ellipsis-right');
    }
    items.push(page);
  }

  return items;
};

interface SkillsManagerProps {
  readOnly?: boolean;
  onCreateByChat?: () => void;
}

const SkillsManager: React.FC<SkillsManagerProps> = ({ readOnly, onCreateByChat }) => {
  const dispatch = useDispatch();
  const skills = useSelector((state: RootState) => state.skill.skills);

  const [skillSearchQuery, setSkillSearchQuery] = useState('');
  const [skillDownloadSource, setSkillDownloadSource] = useState('');
  const [skillActionError, setSkillActionError] = useState('');
  const [isDownloadingSkill, setIsDownloadingSkill] = useState(false);
  const [isAddSkillMenuOpen, setIsAddSkillMenuOpen] = useState(false);
  const [isRemoteImportOpen, setIsRemoteImportOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<SkillTab>('installed');
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [marketplacePage, setMarketplacePage] = useState(1);
  const [marketplacePageSize, setMarketplacePageSize] = useState(estimateMarketplacePageSize);
  const [isLoadingMarketplace, setIsLoadingMarketplace] = useState(false);
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [selectedMarketplaceSkill, setSelectedMarketplaceSkill] = useState<MarketplaceSkill | null>(
    null,
  );
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [skillPendingDelete, setSkillPendingDelete] = useState<Skill | null>(null);
  const [isDeletingSkill, setIsDeletingSkill] = useState(false);
  const [securityReport, setSecurityReport] = useState<SkillSecurityReportData | null>(null);
  const [pendingInstallId, setPendingInstallId] = useState<string | null>(null);
  const [pendingImportSource, setPendingImportSource] = useState<DirectImportSource | null>(null);
  const [isConfirmingInstall, setIsConfirmingInstall] = useState(false);

  const addSkillMenuRef = useRef<HTMLDivElement>(null);
  const addSkillButtonRef = useRef<HTMLButtonElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const marketplaceContentRef = useRef<HTMLDivElement>(null);

  const refreshMarketplace = useCallback(async (forceRefresh = false) => {
    setIsLoadingMarketplace(true);
    try {
      const data = await skillService.fetchMarketplaceSkills({ forceRefresh });
      setMarketplaceSkills(data);
      return data;
    } finally {
      setIsLoadingMarketplace(false);
    }
  }, []);

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
    if (activeTab !== 'marketplace') return;

    refreshMarketplace(true).catch(() => {
      // The refresh helper already keeps the current list if fetch fails.
    });
  }, [activeTab, refreshMarketplace]);

  useEffect(() => {
    let animationFrame = 0;

    const updatePageSize = () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = 0;
        setMarketplacePageSize(estimateMarketplacePageSize());
      });
    };

    updatePageSize();
    window.addEventListener('resize', updatePageSize);

    return () => {
      if (animationFrame) {
        window.cancelAnimationFrame(animationFrame);
      }
      window.removeEventListener('resize', updatePageSize);
    };
  }, []);

  useEffect(() => {
    if (!isAddSkillMenuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideMenu = addSkillMenuRef.current?.contains(target);
      const isInsideButton = addSkillButtonRef.current?.contains(target);
      if (!isInsideMenu && !isInsideButton) {
        setIsAddSkillMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAddSkillMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isAddSkillMenuOpen]);

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

  const filteredSkills = useMemo(() => {
    const query = skillSearchQuery.trim().replace(/\s+/g, ' ').toLowerCase();
    return skills.filter(skill => {
      const matchesSearch =
        resolveSkillName(skill.id, skill.name).toLowerCase().includes(query) ||
        skillService
          .getLocalizedSkillDescription(skill.id, skill.name, skill.description)
          .toLowerCase()
          .includes(query);
      return matchesSearch;
    });
  }, [skills, skillSearchQuery, resolveSkillName]);

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

  const marketplacePageCount = Math.max(
    1,
    Math.ceil(filteredMarketplaceSkills.length / marketplacePageSize),
  );
  const marketplacePageItems = useMemo(() => {
    return getMarketplacePageItems(marketplacePage, marketplacePageCount);
  }, [marketplacePage, marketplacePageCount]);
  const visibleMarketplaceSkills = useMemo(() => {
    const safePage = Math.min(marketplacePage, marketplacePageCount);
    const start = (safePage - 1) * marketplacePageSize;
    return filteredMarketplaceSkills.slice(start, start + marketplacePageSize);
  }, [filteredMarketplaceSkills, marketplacePage, marketplacePageCount, marketplacePageSize]);

  useEffect(() => {
    setMarketplacePage(1);
  }, [skillSearchQuery, activeTab]);

  useEffect(() => {
    if (marketplacePage > marketplacePageCount) {
      setMarketplacePage(marketplacePageCount);
    }
  }, [marketplacePage, marketplacePageCount]);

  useEffect(() => {
    if (activeTab !== 'marketplace' || isLoadingMarketplace) return;

    const frame = window.requestAnimationFrame(() => {
      const content = marketplaceContentRef.current;
      if (!content || content.scrollHeight <= content.clientHeight) return;

      const columns = getMarketplaceColumnCount();
      setMarketplacePageSize(current => Math.max(MARKETPLACE_MIN_PAGE_SIZE, current - columns));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeTab, isLoadingMarketplace, marketplacePageSize, visibleMarketplaceSkills.length]);

  const formatSkillDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const locale = i18nService.getLanguage() === 'zh' ? 'zh-CN' : 'en-US';
    return new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(date);
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

  const handleRequestDeleteSkill = (skill: Skill) => {
    if (skill.isBuiltIn) {
      setSkillActionError(i18nService.t('skillBuiltInCannotDelete'));
      return;
    }
    setSkillActionError('');
    setSkillPendingDelete(skill);
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
      setActiveTab('marketplace');
      setSkillSearchQuery('skill-creator');
      window.dispatchEvent(
        new CustomEvent('app:showToast', { detail: i18nService.t('skillCreatorNotInstalled') }),
      );
      return;
    }

    if (!skillCreator.enabled) {
      // Installed but disabled → switch to installed tab and search
      setActiveTab('installed');
      setSkillSearchQuery('skill-creator');
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
    const installed = skills.find(s => s.id === marketplaceSkill.id);
    if (!installed) return 'not_installed';
    return 'installed';
  };

  const handleInstallMarketplaceSkill = async (skill: MarketplaceSkill) => {
    const installSource = skill.installSource;
    if (installingSkillId || !installSource) return;
    setInstallingSkillId(skill.id);
    setSkillActionError('');
    try {
      const result = await skillService.downloadSkill(installSource);
      if (!result.success) {
        setSkillActionError(result.error || i18nService.t('skillInstallFailed'));
        return;
      }
      // Security audit returned — show report modal
      if (result.auditReport && result.pendingInstallId) {
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
      setInstallingSkillId(null);
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

      <Card
        size="sm"
        className="flex-1 min-h-0 gap-0 overflow-visible rounded-lg border border-border bg-card p-0 ring-0"
      >
        {/* Toolbar */}
        <CardContent className="flex shrink-0 flex-col gap-3 p-3">
          <p className="text-sm text-muted-foreground">{i18nService.t('skillsDescription')}</p>

          {/* Search + Add button */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder={i18nService.t('searchSkills')}
                value={skillSearchQuery}
                onChange={e => setSkillSearchQuery(e.target.value)}
                className="w-full pl-9 pr-8"
              />
              {skillSearchQuery && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  onClick={() => setSkillSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-muted-foreground hover:text-primary transition-colors"
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              )}
            </div>
            <div className="relative">
              <Button
                ref={addSkillButtonRef}
                type="button"
                variant="outline"
                onClick={() => setIsAddSkillMenuOpen(prev => !prev)}
                className="gap-2"
              >
                <PlusCircle className="h-4 w-4" />
                <span>{i18nService.t('addSkill')}</span>
              </Button>

              {isAddSkillMenuOpen && (
                <div
                  ref={addSkillMenuRef}
                  className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-border bg-surface shadow-lg"
                >
                  <p className="border-b border-border px-3 py-2 text-[11px] text-orange-600 dark:text-orange-400">
                    {i18nService.t('addSkillSecurityTip')}
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleUploadSkillZip}
                    disabled={isDownloadingSkill}
                    className="w-full flex items-center justify-start gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50 rounded-none"
                  >
                    <Upload className="h-4 w-4 text-muted-foreground" />
                    <span>{i18nService.t('uploadSkillZip')}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleUploadSkillFolder}
                    disabled={isDownloadingSkill}
                    className="w-full flex items-center justify-start gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50 rounded-none"
                  >
                    <FolderOpen className="h-4 w-4 text-muted-foreground" />
                    <span>{i18nService.t('uploadSkillFolder')}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleOpenRemoteImport}
                    className="w-full flex items-center justify-start gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-surface-raised transition-colors rounded-none"
                  >
                    <Link className="h-4 w-4 text-muted-foreground" />
                    <span>{i18nService.t('remoteImport')}</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleCreateByChat}
                    className="w-full flex items-center justify-start gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-surface-raised transition-colors rounded-none"
                  >
                    <Pencil className="h-4 w-4 text-muted-foreground" />
                    <span>{i18nService.t('createSkillByChat')}</span>
                  </Button>
                </div>
              )}
            </div>
          </div>

          <Tabs value={activeTab} onValueChange={value => setActiveTab(value as SkillTab)}>
            <TabsList className="shadow-inset">
              <TabsTrigger value="installed" className="data-active:shadow-elevated">
                {i18nService.t('skillInstalled')}
                {skills.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-xs">
                    {skills.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="marketplace" className="data-active:shadow-elevated">
                {i18nService.t('skillMarketplace')}
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </CardContent>
        <Separator />
        <CardContent className="min-h-0 flex-1 p-0">
          <div
            ref={marketplaceContentRef}
            className={cn(
              'h-full min-h-0 p-3',
              activeTab === 'marketplace' ? 'overflow-hidden' : 'overflow-y-auto',
            )}
          >
            {activeTab === 'installed' && (
              <>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {filteredSkills.length === 0 ? (
                    <div className="col-span-2 text-center py-8 text-sm text-muted-foreground">
                      {i18nService.t('noSkillsAvailable')}
                    </div>
                  ) : (
                    filteredSkills.map(skill => (
                      <div
                        key={skill.id}
                        className="cursor-pointer rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted"
                        onClick={() => setSelectedSkill(skill)}
                      >
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                              <Puzzle className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <span className="text-sm font-medium text-foreground truncate">
                              {resolveSkillName(skill.id, skill.name)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {!readOnly && !skill.isBuiltIn && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={e => {
                                  e.stopPropagation();
                                  handleRequestDeleteSkill(skill);
                                }}
                                className="rounded-lg text-muted-foreground hover:text-red-500 dark:hover:text-red-400 transition-colors"
                                title={i18nService.t('deleteSkill')}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                            <Switch
                              checked={skill.enabled}
                              onCheckedChange={() => handleToggleSkill(skill.id)}
                              disabled={readOnly}
                            />
                          </div>
                        </div>

                        <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                          {skillService.getLocalizedSkillDescription(
                            skill.id,
                            skill.name,
                            skill.description,
                          )}
                        </p>

                        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                          <div className="flex items-center gap-2">
                            {skill.isOfficial && (
                              <>
                                <span className="px-1.5 py-0.5 rounded bg-primary-muted text-primary font-medium">
                                  {i18nService.t('official')}
                                </span>
                                <span>·</span>
                              </>
                            )}
                            {skill.version && (
                              <>
                                <span className="px-1.5 py-0.5 rounded bg-surface-raised font-medium">
                                  v{skill.version}
                                </span>
                                <span>·</span>
                              </>
                            )}
                            <span>{formatSkillDate(skill.updatedAt)}</span>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {activeTab === 'marketplace' &&
              (isLoadingMarketplace ? (
                <div className="text-center py-12 text-sm text-muted-foreground">
                  {i18nService.t('downloadingSkill')}
                </div>
              ) : (
                <>
                  <div className="mb-1 flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        {i18nService.t('skillMarketplaceFeaturedTitle')}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {i18nService.t('skillMarketplaceFeaturedDescription')}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        void window.electron.shell.openExternal('https://modelscope.cn/skills')
                      }
                      className="gap-1.5"
                    >
                      <Link className="h-3.5 w-3.5" />
                      {i18nService.t('skillMarketplaceOpenExternal')}
                    </Button>
                  </div>
                  {filteredMarketplaceSkills.length === 0 ? (
                    <div className="text-center py-12 text-sm text-muted-foreground">
                      {i18nService.t('skillMarketplaceEmpty')}
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {visibleMarketplaceSkills.map(skill => (
                          <div
                            key={skill.id}
                            className="cursor-pointer rounded-lg border border-border bg-card p-3 transition-colors hover:bg-muted"
                            onClick={() => setSelectedMarketplaceSkill(skill)}
                          >
                            <div className="flex items-start justify-between mb-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                                  <Puzzle className="h-4 w-4 text-muted-foreground" />
                                </div>
                                <span className="text-sm font-medium text-foreground truncate">
                                  {resolveSkillName(skill.id, skill.name)}
                                </span>
                              </div>
                              <div className="shrink-0">
                                {(() => {
                                  const status = getSkillInstallStatus(skill);
                                  if (status === 'installed') {
                                    return (
                                      <span className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg text-green-600 dark:text-green-400 bg-green-500/10">
                                        <CheckCircle className="h-3.5 w-3.5" />
                                        {i18nService.t('skillAlreadyInstalled')}
                                      </span>
                                    );
                                  }
                                  return !readOnly && skill.installSource ? (
                                    <Button
                                      type="button"
                                      size="xs"
                                      onClick={e => {
                                        e.stopPropagation();
                                        handleInstallMarketplaceSkill(skill);
                                      }}
                                      disabled={installingSkillId !== null}
                                      className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                      {installingSkillId === skill.id
                                        ? i18nService.t('skillInstalling')
                                        : i18nService.t('skillInstall')}
                                    </Button>
                                  ) : null;
                                })()}
                              </div>
                            </div>

                            <p className="text-xs text-muted-foreground line-clamp-2 mb-2">
                              {resolveLocalizedText(skill.description)}
                            </p>

                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                              {skill.source?.from && (
                                <>
                                  <span className="px-1.5 py-0.5 rounded bg-surface-raised font-medium">
                                    {skill.source.from}
                                  </span>
                                  <span>·</span>
                                </>
                              )}
                              {skill.version && (
                                <>
                                  <span className="px-1.5 py-0.5 rounded bg-surface-raised font-medium">
                                    v{skill.version}
                                  </span>
                                </>
                              )}
                              {skill.stats?.stars != null && skill.stats.stars > 0 && (
                                <>
                                  <span>·</span>
                                  <span className="px-1.5 py-0.5 rounded bg-surface-raised font-medium">
                                    ★ {skill.stats.stars}
                                  </span>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                      {filteredMarketplaceSkills.length > marketplacePageSize && (
                        <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-muted-foreground">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setMarketplacePage(page => Math.max(1, page - 1))}
                            disabled={marketplacePage <= 1}
                            className="px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {i18nService.t('skillMarketplacePrevPage')}
                          </Button>
                          <div className="flex items-center gap-1">
                            {marketplacePageItems.map(item =>
                              typeof item === 'number' ? (
                                <Button
                                  key={item}
                                  type="button"
                                  variant={item === marketplacePage ? 'default' : 'outline'}
                                  size="sm"
                                  onClick={() => setMarketplacePage(item)}
                                  className="min-w-8 px-2 py-1.5 rounded-lg transition-colors"
                                >
                                  {item}
                                </Button>
                              ) : (
                                <span key={item} className="px-1 text-muted-foreground">
                                  ...
                                </span>
                              ),
                            )}
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setMarketplacePage(page => Math.min(marketplacePageCount, page + 1))
                            }
                            disabled={marketplacePage >= marketplacePageCount}
                            className="px-3 py-1.5 rounded-lg border border-border bg-surface hover:bg-surface-raised disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {i18nService.t('skillMarketplaceNextPage')}
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </>
              ))}
          </div>
        </CardContent>
      </Card>

      {selectedMarketplaceSkill &&
        createPortal(
          <Modal
            onClose={() => setSelectedMarketplaceSkill(null)}
            overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            className="flex max-h-[calc(100dvh-3rem)] w-full max-w-md flex-col gap-0 rounded-xl border border-border bg-surface p-0 shadow-xl sm:max-w-md"
          >
            <div className="flex shrink-0 items-start justify-between px-6 pt-6">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-background flex items-center justify-center shrink-0">
                  <Puzzle className="h-5 w-5 text-muted-foreground" />
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
          <Modal
            onClose={() => setSelectedSkill(null)}
            overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
            className="flex max-h-[calc(100dvh-3rem)] w-full max-w-md flex-col gap-0 rounded-xl border border-border bg-surface p-0 shadow-xl sm:max-w-md"
          >
            <div className="flex shrink-0 items-start justify-between px-6 pt-6">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-background flex items-center justify-center shrink-0">
                  <Puzzle className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="min-w-0">
                  <DialogTitle className="truncate text-base font-semibold text-foreground">
                    {selectedSkill.name}
                  </DialogTitle>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setSelectedSkill(null)}
                className="rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-raised transition-colors shrink-0"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1 px-6">
              <div className="flex min-w-0 flex-col gap-4 py-4">
                <p className="break-words text-sm text-muted-foreground">
                  {skillService.getLocalizedSkillDescription(
                    selectedSkill.id,
                    selectedSkill.name,
                    selectedSkill.description,
                  )}
                </p>

                <div className="flex flex-col gap-2">
                  {(() => {
                    const mp = marketplaceSkills.find(m => m.id === selectedSkill.id);
                    return (
                      <>
                        {selectedSkill.isOfficial && (
                          <div className="flex min-w-0 items-start gap-2 text-xs">
                            <span className="w-16 shrink-0 pt-0.5 text-muted-foreground">
                              {i18nService.t('skillDetailSource')}
                            </span>
                            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                              <span className="rounded bg-primary-muted px-1.5 py-0.5 font-medium text-primary">
                                {i18nService.t('official')}
                              </span>
                              {mp?.source?.author && (
                                <span className="break-words rounded bg-surface-raised px-1.5 py-0.5 font-medium text-foreground">
                                  {mp.source.author}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        {!selectedSkill.isOfficial && mp?.source?.from && (
                          <div className="flex min-w-0 items-start gap-2 text-xs">
                            <span className="w-16 shrink-0 pt-0.5 text-muted-foreground">
                              {i18nService.t('skillDetailSource')}
                            </span>
                            <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                              <span className="break-words rounded bg-surface-raised px-1.5 py-0.5 font-medium text-foreground">
                                {mp.source.from}
                              </span>
                              {mp.source.author && (
                                <span className="break-words rounded bg-surface-raised px-1.5 py-0.5 font-medium text-foreground">
                                  {mp.source.author}
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                        {mp?.source?.url && (
                          <div className="flex min-w-0 items-start gap-2 text-xs">
                            <span className="w-16 shrink-0 pt-0.5 text-muted-foreground">URL</span>
                            <Button
                              type="button"
                              variant="link"
                              className="h-auto min-w-0 flex-1 justify-start break-all whitespace-normal px-0 text-left text-primary hover:underline"
                              onClick={e => {
                                e.stopPropagation();
                                window.electron.shell.openExternal(mp.source.url);
                              }}
                            >
                              {mp.source.url}
                            </Button>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              </div>
            </ScrollArea>

            <div className="flex shrink-0 items-center justify-between border-t border-border px-6 pb-6 pt-4">
              {!readOnly && !selectedSkill.isBuiltIn ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    setSelectedSkill(null);
                    handleRequestDeleteSkill(selectedSkill);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-xl transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  {i18nService.t('deleteSkill')}
                </Button>
              ) : (
                <div />
              )}
              <Switch
                checked={selectedSkill.enabled}
                onCheckedChange={() => {
                  if (readOnly) return;
                  handleToggleSkill(selectedSkill.id);
                  setSelectedSkill({ ...selectedSkill, enabled: !selectedSkill.enabled });
                }}
                disabled={readOnly}
              />
            </div>
          </Modal>,
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
                className="w-full px-3 py-2.5 text-sm rounded-xl bg-background text-foreground placeholder-secondary border border-border focus-visible:ring-2 focus-visible:ring-primary"
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
