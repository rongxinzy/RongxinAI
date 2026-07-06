import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Switch } from '@shared/components/ui/switch';
import { CheckCircle, Download, FolderOpen, Link, Pencil, PlusCircle, Puzzle, Search, Trash2, Upload, X, XCircle } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDispatch, useSelector } from 'react-redux';

import type { SkillSecurityReport as SkillSecurityReportData } from '../../../main/libs/skillSecurity/skillSecurityTypes';
import { i18nService } from '../../services/i18n';
import { resolveLocalizedText, skillService } from '../../services/skill';
import { RootState } from '../../store';
import { setSkills } from '../../store/slices/skillSlice';
import { MarketplaceSkill, MarketTag,Skill } from '../../types/skill';
import Modal from '../common/Modal';
import ErrorMessage from '../ErrorMessage';
import SkillSecurityReport from './SkillSecurityReport';

type SkillTab = 'installed' | 'marketplace';
type ImportSourceType = 'github' | 'clawhub';
type DirectImportSource = 'zip' | 'folder' | 'remote';

const importSourceTypes: ImportSourceType[] = ['github', 'clawhub'];
const MARKETPLACE_MIN_PAGE_SIZE = 8;
const MARKETPLACE_MAX_PAGE_SIZE = 40;
const MARKETPLACE_DEFAULT_PAGE_SIZE = 20;
const MARKETPLACE_PAGE_WINDOW = 2;
const MARKETPLACE_RETRYABLE_ERROR_CODES = new Set(['clawhub_not_found']);

type MarketplacePageItem = number | 'ellipsis-left' | 'ellipsis-right';

const estimateMarketplacePageSize = () => {
  if (typeof window === 'undefined') {
    return MARKETPLACE_DEFAULT_PAGE_SIZE;
  }

  const columns = window.innerWidth >= 1536
    ? 4
    : window.innerWidth >= 1280
      ? 3
      : window.innerWidth >= 768
        ? 2
        : 1;
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

const importTabConfig: Record<ImportSourceType, {
  tabLabelKey: string;
  descriptionKey: string;
  urlLabelKey: string;
  placeholderKey: string;
  examplesKey: string;
}> = {
  github: {
    tabLabelKey: 'githubTabLabel',
    descriptionKey: 'githubImportDescription',
    urlLabelKey: 'githubImportUrlLabel',
    placeholderKey: 'githubSkillPlaceholder',
    examplesKey: 'githubImportExamples',
  },
  clawhub: {
    tabLabelKey: 'clawhubTabLabel',
    descriptionKey: 'clawhubImportDescription',
    urlLabelKey: 'clawhubImportUrlLabel',
    placeholderKey: 'clawhubSkillPlaceholder',
    examplesKey: 'clawhubImportExamples',
  },
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
  const [importTab, setImportTab] = useState<ImportSourceType>('github');
  const [activeTab, setActiveTab] = useState<SkillTab>('installed');
  const [marketplaceSkills, setMarketplaceSkills] = useState<MarketplaceSkill[]>([]);
  const [marketTags, setMarketTags] = useState<MarketTag[]>([]);
  const [activeMarketTag, setActiveMarketTag] = useState('all');
  const [marketplacePage, setMarketplacePage] = useState(1);
  const [marketplacePageSize, setMarketplacePageSize] = useState(estimateMarketplacePageSize);
  const [isLoadingMarketplace, setIsLoadingMarketplace] = useState(false);
  const [installingSkillId, setInstallingSkillId] = useState<string | null>(null);
  const [selectedMarketplaceSkill, setSelectedMarketplaceSkill] = useState<MarketplaceSkill | null>(null);
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

  const refreshMarketplace = useCallback(async (forceRefresh = false) => {
    setIsLoadingMarketplace(true);
    try {
      const data = await skillService.fetchMarketplaceSkills({ forceRefresh });
      setMarketplaceSkills(data.skills);
      setMarketTags(data.tags);
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
    let isActive = true;
    refreshMarketplace(false).then((data) => {
      if (!isActive) return;
      setMarketplaceSkills(data.skills);
      setMarketTags(data.tags);
    });
    return () => { isActive = false; };
  }, [refreshMarketplace]);

  useEffect(() => {
    if (activeTab !== 'marketplace') return;

    let isActive = true;
    refreshMarketplace(true).then((data) => {
      if (!isActive) return;
      setMarketplaceSkills(data.skills);
      setMarketTags(data.tags);
    }).catch(() => {
      // The refresh helper already keeps the current list if fetch fails.
    });

    return () => {
      isActive = false;
    };
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
  }, [isRemoteImportOpen, importTab]);

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

  const resolveSkillName = useCallback((id: string, fallback: string): string =>
    marketplaceNameMap.get(id) || fallback, [marketplaceNameMap]);

  const filteredSkills = useMemo(() => {
    const query = skillSearchQuery.trim().replace(/\s+/g, ' ').toLowerCase();
    return skills.filter(skill => {
      const matchesSearch = resolveSkillName(skill.id, skill.name).toLowerCase().includes(query)
        || skillService.getLocalizedSkillDescription(skill.id, skill.name, skill.description).toLowerCase().includes(query);
      return matchesSearch;
    });
  }, [skills, skillSearchQuery, resolveSkillName]);

  const filteredMarketplaceSkills = useMemo(() => {
    const query = skillSearchQuery.trim().replace(/\s+/g, ' ').toLowerCase();
    let results = marketplaceSkills;
    if (query) {
      results = results.filter(skill => {
        return skill.name.toLowerCase().includes(query)
          || resolveLocalizedText(skill.description).toLowerCase().includes(query);
      });
    }
    if (activeMarketTag !== 'all') {
      results = results.filter(skill => skill.tags?.includes(activeMarketTag));
    }
    return results;
  }, [marketplaceSkills, skillSearchQuery, activeMarketTag]);

  const marketplacePageCount = Math.max(1, Math.ceil(filteredMarketplaceSkills.length / marketplacePageSize));
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
  }, [skillSearchQuery, activeMarketTag, activeTab]);

  useEffect(() => {
    if (marketplacePage > marketplacePageCount) {
      setMarketplacePage(marketplacePageCount);
    }
  }, [marketplacePage, marketplacePageCount]);

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
      setSkillActionError(error instanceof Error ? error.message : i18nService.t('skillUpdateFailed'));
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
    console.log('[SkillsManager] downloadSkill result:', JSON.stringify({
      success: result.success,
      error: result.error,
      hasAuditReport: !!result.auditReport,
      pendingInstallId: result.pendingInstallId,
      riskLevel: result.auditReport?.riskLevel,
      findingsCount: result.auditReport?.findings?.length,
    }));
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
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('skillCreatorNotInstalled') }));
      return;
    }

    if (!skillCreator.enabled) {
      // Installed but disabled → switch to installed tab and search
      setActiveTab('installed');
      setSkillSearchQuery('skill-creator');
      window.dispatchEvent(new CustomEvent('app:showToast', { detail: i18nService.t('skillCreatorNotEnabled') }));
      return;
    }

    onCreateByChat?.();
  };

  const handleImportFromDialog = async () => {
    if (isDownloadingSkill) return;
    const trimmed = skillDownloadSource.trim();
    if (!trimmed) return;

    // Validate URL matches the selected tab
    try {
      const url = new URL(trimmed);
      const host = url.hostname.toLowerCase();
      if (importTab === 'clawhub' && host !== 'clawhub.ai' && host !== 'www.clawhub.ai') {
        setSkillActionError(i18nService.t('importSourceMismatchClawhub'));
        return;
      }
      if (importTab === 'github' && !host.includes('github.com') && !host.includes('github.io')) {
        setSkillActionError(i18nService.t('importSourceMismatchGithub'));
        return;
      }
    } catch {
      // Not a URL (e.g. "owner/repo" shorthand for GitHub) — only allow on GitHub tab
      if (importTab === 'clawhub') {
        setSkillActionError(i18nService.t('importSourceMismatchClawhub'));
        return;
      }
    }

    await handleAddSkillFromSource(trimmed, 'remote');
  };

  const getSkillInstallStatus = (marketplaceSkill: MarketplaceSkill): 'not_installed' | 'installed' => {
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
      let result = await skillService.downloadSkill(installSource);
      if (!result.success && MARKETPLACE_RETRYABLE_ERROR_CODES.has(result.errorCode || '')) {
        const latestMarketplace = await refreshMarketplace(true);
        const latestSkill = latestMarketplace.skills.find(item => item.id === skill.id);
        if (!latestSkill) {
          setSkillActionError(i18nService.t('skillDownloadFailedNotFound'));
          return;
        }
        if (!latestSkill.installSource) {
          setSkillActionError(i18nService.t('skillDownloadFailedNotFound'));
          return;
        }
        result = await skillService.downloadSkill(latestSkill.installSource);
      }
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
    if (!pendingInstallId) return;
    setIsConfirmingInstall(true);
    let shouldCloseSecurityReport = action === 'cancel';
    try {
      const result = await skillService.confirmInstall(pendingInstallId, action);
      if (result.success && result.skills) {
        dispatch(setSkills(result.skills));
        if (action !== 'cancel' && pendingImportSource) {
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
    <div className="space-y-4">
      <div>
        <p className="text-sm text-secondary">
          {i18nService.t('skillsDescription')}
        </p>
      </div>

      {skillActionError && !isRemoteImportOpen && (
        <ErrorMessage
          message={skillActionError}
          onClose={() => setSkillActionError('')}
        />
      )}

      {/* Sticky toolbar: Description + Search + Tabs + Tag pills */}
      <div className="sticky top-0 z-10 bg-claude-bg dark:bg-claude-darkBg pb-4 space-y-4 shadow-sm">
        {/* Search + Add button */}
        <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-secondary" />
          <Input
            type="text"
            placeholder={i18nService.t('searchSkills')}
            value={skillSearchQuery}
            onChange={(e) => setSkillSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 text-sm rounded-xl bg-surface text-foreground placeholder-secondary border border-border focus-visible:ring-2 focus-visible:ring-primary"
          />
          {skillSearchQuery && (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => setSkillSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded text-secondary hover:text-primary transition-colors"
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
            className="px-3 py-2 text-sm rounded-xl border transition-colors bg-surface border-border text-foreground hover:bg-surface-raised flex items-center gap-2"
          >
            <PlusCircle className="h-4 w-4" />
            <span>{i18nService.t('addSkill')}</span>
          </Button>

          {isAddSkillMenuOpen && (
            <div
              ref={addSkillMenuRef}
              className="absolute right-0 mt-2 w-72 rounded-xl border border-border bg-surface shadow-lg z-50 overflow-hidden"
            >
              <p className="px-3 py-2 text-[11px] text-orange-600 dark:text-orange-400 border-b border-border">
                {i18nService.t('addSkillSecurityTip')}
              </p>
              <Button
                type="button"
                variant="ghost"
                onClick={handleUploadSkillZip}
                disabled={isDownloadingSkill}
                className="w-full flex items-center justify-start gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50 rounded-none"
              >
                <Upload className="h-4 w-4 text-secondary" />
                <span>{i18nService.t('uploadSkillZip')}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleUploadSkillFolder}
                disabled={isDownloadingSkill}
                className="w-full flex items-center justify-start gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-surface-raised transition-colors disabled:opacity-50 rounded-none"
              >
                <FolderOpen className="h-4 w-4 text-secondary" />
                <span>{i18nService.t('uploadSkillFolder')}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleOpenRemoteImport}
                className="w-full flex items-center justify-start gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-surface-raised transition-colors rounded-none"
              >
                <Link className="h-4 w-4 text-secondary" />
                <span>{i18nService.t('remoteImport')}</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={handleCreateByChat}
                className="w-full flex items-center justify-start gap-3 px-3 py-2.5 text-sm text-foreground hover:bg-surface-raised transition-colors rounded-none"
              >
                <Pencil className="h-4 w-4 text-secondary" />
                <span>{i18nService.t('createSkillByChat')}</span>
              </Button>
            </div>
          )}
        </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center border-b border-border">
          <Button
            type="button"
            variant={activeTab === 'installed' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('installed')}
            className="px-4 py-2 text-sm font-medium transition-colors relative rounded-none"
          >
            {i18nService.t('skillInstalled')}
            {skills.length > 0 && (
              <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-surface-raised">
                {skills.length}
              </span>
            )}
            <div className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-full transition-colors ${
              activeTab === 'installed' ? 'bg-primary' : 'bg-transparent'
            }`} />
          </Button>
          <Button
            type="button"
            variant={activeTab === 'marketplace' ? 'default' : 'ghost'}
            onClick={() => setActiveTab('marketplace')}
            className="px-4 py-2 text-sm font-medium transition-colors relative rounded-none"
          >
            {i18nService.t('skillMarketplace')}
            <div className={`absolute bottom-0 left-0 right-0 h-0.5 rounded-full transition-colors ${
              activeTab === 'marketplace' ? 'bg-primary' : 'bg-transparent'
            }`} />
          </Button>
        </div>

        {/* Tag filter pills (Marketplace only) */}
        {activeTab === 'marketplace' && !isLoadingMarketplace && marketTags.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap">
            <Button
              type="button"
              variant={activeMarketTag === 'all' ? 'default' : 'outline'}
              size="xs"
              onClick={() => setActiveMarketTag('all')}
              className="px-2.5 py-1 text-xs rounded-lg transition-colors"
            >
              {i18nService.t('skillCategoryAll')}
            </Button>
            {marketTags.map((tag) => (
              <Button
                key={tag.id}
                type="button"
                variant={activeMarketTag === tag.id ? 'default' : 'outline'}
                size="xs"
                onClick={() => setActiveMarketTag(tag.id)}
                className="px-2.5 py-1 text-xs rounded-lg transition-colors"
              >
                {resolveLocalizedText(tag)}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div>
      {activeTab === 'installed' && (
      <>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
        {filteredSkills.length === 0 ? (
          <div className="col-span-2 text-center py-8 text-sm text-secondary">
            {i18nService.t('noSkillsAvailable')}
          </div>
        ) : (
          filteredSkills.map((skill) => (
            <div
              key={skill.id}
              className="rounded-xl border border-border bg-surface p-3 transition-colors hover:border-primary cursor-pointer"
              onClick={() => setSelectedSkill(skill)}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-7 h-7 rounded-lg bg-surface flex items-center justify-center flex-shrink-0">
                    <Puzzle className="h-4 w-4 text-secondary" />
                  </div>
                  <span className="text-sm font-medium text-foreground truncate">
                    {resolveSkillName(skill.id, skill.name)}
                  </span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {!readOnly && !skill.isBuiltIn && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={(e) => { e.stopPropagation(); handleRequestDeleteSkill(skill); }}
                      className="rounded-lg text-secondary hover:text-red-500 dark:hover:text-red-400 transition-colors"
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

              <p className="text-xs text-secondary line-clamp-2 mb-2">
                {skillService.getLocalizedSkillDescription(skill.id, skill.name, skill.description)}
              </p>

              <div className="flex items-center justify-between text-[10px] text-secondary">
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

      {activeTab === 'marketplace' && (
        isLoadingMarketplace ? (
          <div className="text-center py-12 text-sm text-secondary">
            {i18nService.t('downloadingSkill')}
          </div>
        ) : (
          <>
            <div className="mb-3 flex flex-col gap-3 rounded-xl border border-border bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-sm font-medium text-foreground">
                  {i18nService.t('skillMarketplaceFeaturedTitle')}
                </div>
                <p className="mt-1 text-xs text-secondary">
                  {i18nService.t('skillMarketplaceFeaturedDescription')}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void window.electron.shell.openExternal('https://clawhub.ai/skills')}
                className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
              >
                <Link className="h-3.5 w-3.5" />
                {i18nService.t('skillMarketplaceOpenClawHub')}
              </Button>
            </div>
            {filteredMarketplaceSkills.length === 0 ? (
              <div className="text-center py-12 text-sm text-secondary">
                {i18nService.t('skillMarketplaceEmpty')}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                  {visibleMarketplaceSkills.map((skill) => (
                <div
                key={skill.id}
                className="rounded-xl border border-border bg-surface p-3 transition-colors hover:border-primary cursor-pointer"
                onClick={() => setSelectedMarketplaceSkill(skill)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-surface flex items-center justify-center flex-shrink-0">
                      <Puzzle className="h-4 w-4 text-secondary" />
                    </div>
                    <span className="text-sm font-medium text-foreground truncate">
                      {resolveSkillName(skill.id, skill.name)}
                    </span>
                  </div>
                  <div className="flex-shrink-0">
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
                      return !readOnly ? (
                        <Button
                          type="button"
                          size="xs"
                          onClick={(e) => { e.stopPropagation(); handleInstallMarketplaceSkill(skill); }}
                          disabled={installingSkillId !== null}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <Download className="h-3.5 w-3.5" />
                          {installingSkillId === skill.id ? i18nService.t('skillInstalling') : i18nService.t('skillInstall')}
                        </Button>
                      ) : null;
                    })()}
                  </div>
                </div>

                <p className="text-xs text-secondary line-clamp-2 mb-2">
                  {resolveLocalizedText(skill.description)}
                </p>

                <div className="flex items-center gap-2 text-[10px] text-secondary">
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
              <div className="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-secondary">
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
                  {marketplacePageItems.map((item) => (
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
                      <span key={item} className="px-1 text-secondary">
                        ...
                      </span>
                    )
                  ))}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setMarketplacePage(page => Math.min(marketplacePageCount, page + 1))}
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
        )
      )}
      </div>

      {selectedMarketplaceSkill && createPortal(
        <Modal onClose={() => setSelectedMarketplaceSkill(null)} overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/60" className="w-full max-w-md mx-4 rounded-2xl bg-surface border border-border shadow-2xl p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-background flex items-center justify-center flex-shrink-0">
                  <Puzzle className="h-5 w-5 text-secondary" />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-semibold text-foreground truncate">
                    {selectedMarketplaceSkill.name}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setSelectedMarketplaceSkill(null)}
                className="rounded-lg text-secondary hover:text-foreground hover:bg-surface-raised transition-colors flex-shrink-0"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <p className="text-sm text-secondary mb-4">
              {resolveLocalizedText(selectedMarketplaceSkill.description)}
            </p>

            <div className="space-y-2 mb-5">
              {selectedMarketplaceSkill.version && (
                <div className="flex items-center text-xs">
                  <span className="w-16 flex-shrink-0 text-secondary">{i18nService.t('skillDetailVersion')}</span>
                  <span className="px-1.5 py-0.5 rounded bg-surface-raised text-foreground font-medium">
                    v{selectedMarketplaceSkill.version}
                  </span>
                </div>
              )}
              {selectedMarketplaceSkill.source?.from && (
                <div className="flex items-center text-xs">
                  <span className="w-16 flex-shrink-0 text-secondary">{i18nService.t('skillDetailSource')}</span>
                  <span className="px-1.5 py-0.5 rounded bg-surface-raised text-foreground font-medium">
                    {selectedMarketplaceSkill.source.from}
                  </span>
                  {selectedMarketplaceSkill.source.author && (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded bg-surface-raised text-foreground font-medium">
                      {selectedMarketplaceSkill.source.author}
                    </span>
                  )}
                </div>
              )}
              {selectedMarketplaceSkill.source?.url && (
                <div className="flex items-start text-xs">
                  <span className="w-16 flex-shrink-0 text-secondary pt-0.5">URL</span>
                  <Button
                    type="button"
                    variant="link"
                    className="text-primary hover:underline break-all text-left px-0 h-auto"
                    onClick={(e) => { e.stopPropagation(); window.electron.shell.openExternal(selectedMarketplaceSkill.source.url); }}
                  >
                    {selectedMarketplaceSkill.source.url}
                  </Button>
                </div>
              )}
            </div>

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
              return !readOnly ? (
                <Button
                  type="button"
                  onClick={() => handleInstallMarketplaceSkill(selectedMarketplaceSkill)}
                  disabled={installingSkillId !== null}
                  className="w-full py-2.5 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
                >
                  <Download className="h-4 w-4" />
                  {installingSkillId === selectedMarketplaceSkill.id ? i18nService.t('skillInstalling') : i18nService.t('skillInstall')}
                </Button>
              ) : null;
            })()}
        </Modal>
      , document.body)}

      {selectedSkill && createPortal(
        <Modal onClose={() => setSelectedSkill(null)} overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/60" className="w-full max-w-md mx-4 rounded-2xl bg-surface border border-border shadow-2xl p-6">
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-background flex items-center justify-center flex-shrink-0">
                  <Puzzle className="h-5 w-5 text-secondary" />
                </div>
                <div className="min-w-0">
                  <div className="text-base font-semibold text-foreground truncate">
                    {selectedSkill.name}
                  </div>
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setSelectedSkill(null)}
                className="rounded-lg text-secondary hover:text-foreground hover:bg-surface-raised transition-colors flex-shrink-0"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <p className="text-sm text-secondary mb-4">
              {skillService.getLocalizedSkillDescription(selectedSkill.id, selectedSkill.name, selectedSkill.description)}
            </p>

            <div className="space-y-2 mb-5">
              {(() => {
                const mp = marketplaceSkills.find(m => m.id === selectedSkill.id);
                return (
                  <>
                    {selectedSkill.isOfficial && (
                      <div className="flex items-center text-xs">
                        <span className="w-16 flex-shrink-0 text-secondary">{i18nService.t('skillDetailSource')}</span>
                        <span className="px-1.5 py-0.5 rounded bg-primary-muted text-primary font-medium">
                          {i18nService.t('official')}
                        </span>
                        {mp?.source?.author && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-surface-raised text-foreground font-medium">
                            {mp.source.author}
                          </span>
                        )}
                      </div>
                    )}
                    {!selectedSkill.isOfficial && mp?.source?.from && (
                      <div className="flex items-center text-xs">
                        <span className="w-16 flex-shrink-0 text-secondary">{i18nService.t('skillDetailSource')}</span>
                        <span className="px-1.5 py-0.5 rounded bg-surface-raised text-foreground font-medium">
                          {mp.source.from}
                        </span>
                        {mp.source.author && (
                          <span className="ml-1.5 px-1.5 py-0.5 rounded bg-surface-raised text-foreground font-medium">
                            {mp.source.author}
                          </span>
                        )}
                      </div>
                    )}
                    {mp?.source?.url && (
                      <div className="flex items-start text-xs">
                        <span className="w-16 flex-shrink-0 text-secondary pt-0.5">URL</span>
                        <Button
                          type="button"
                          variant="link"
                          className="text-primary hover:underline break-all text-left px-0 h-auto"
                          onClick={(e) => { e.stopPropagation(); window.electron.shell.openExternal(mp.source.url); }}
                        >
                          {mp.source.url}
                        </Button>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            <div className="flex items-center justify-between">
              {!readOnly && !selectedSkill.isBuiltIn ? (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => { setSelectedSkill(null); handleRequestDeleteSkill(selectedSkill); }}
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
        </Modal>
      , document.body)}

      {skillPendingDelete && createPortal(
        <Modal onClose={handleCancelDeleteSkill} overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/60" className="w-full max-w-sm mx-4 rounded-2xl bg-surface border border-border shadow-2xl p-5">
            <div className="text-lg font-semibold text-foreground">
              {i18nService.t('deleteSkill')}
            </div>
            <p className="mt-2 text-sm text-secondary">
              {i18nService.t('skillDeleteConfirm').replace('{name}', skillPendingDelete.name)}
            </p>
            {skillActionError && (
              <div className="mt-3 text-xs text-red-500">
                {skillActionError}
              </div>
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
        </Modal>
      , document.body)}

      {isRemoteImportOpen && createPortal(
        <Modal onClose={() => { setIsRemoteImportOpen(false); setSkillActionError(''); }} overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/60" className="w-full max-w-md mx-4 rounded-2xl bg-surface border border-border shadow-2xl p-6">
            <div className="flex items-start justify-between">
              <div className="text-lg font-semibold text-foreground">
                {i18nService.t('remoteImportTitle')}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => { setIsRemoteImportOpen(false); setSkillActionError(''); }}
                className="rounded-lg text-secondary hover:text-foreground hover:bg-surface-raised transition-colors"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="mt-4 flex items-center gap-1 border-b border-border">
              {importSourceTypes.map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant={importTab === type ? 'default' : 'ghost'}
                  onClick={() => { setImportTab(type); setSkillDownloadSource(''); setSkillActionError(''); }}
                  className="px-3 py-1.5 text-sm font-medium transition-colors relative rounded-none"
                >
                  {i18nService.t(importTabConfig[type].tabLabelKey)}
                  {importTab === type && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
                  )}
                </Button>
              ))}
            </div>

            <div className="mt-4 space-y-3">
              <p className="text-sm text-secondary">
                {i18nService.t(importTabConfig[importTab].descriptionKey)}
              </p>
              <div className="text-xs font-semibold tracking-wide text-secondary">
                {i18nService.t(importTabConfig[importTab].urlLabelKey)}
              </div>
              <Input
                ref={importInputRef}
                type="text"
                value={skillDownloadSource}
                onChange={(e) => setSkillDownloadSource(e.target.value)}
                placeholder={i18nService.t(importTabConfig[importTab].placeholderKey)}
                className="w-full px-3 py-2.5 text-sm rounded-xl bg-background text-foreground placeholder-secondary border border-border focus-visible:ring-2 focus-visible:ring-primary"
              />
              <p className="text-xs text-secondary">
                {i18nService.t(importTabConfig[importTab].examplesKey)}
              </p>
              {skillActionError && (
                <div className="text-xs text-red-500">
                  {skillActionError}
                </div>
              )}
              <Button
                type="button"
                onClick={handleImportFromDialog}
                disabled={isDownloadingSkill || !skillDownloadSource.trim()}
                className="w-full py-2.5 rounded-xl text-white text-sm font-medium transition-colors disabled:opacity-50"
              >
                {isDownloadingSkill ? i18nService.t('importingSkill') : i18nService.t('importSkill')}
              </Button>
            </div>
        </Modal>
      , document.body)}

      {securityReport && (
        <SkillSecurityReport
          report={securityReport}
          onAction={handleSecurityReportAction}
          isLoading={isConfirmingInstall}
        />
      )}

    </div>
  );
};

export default SkillsManager;
