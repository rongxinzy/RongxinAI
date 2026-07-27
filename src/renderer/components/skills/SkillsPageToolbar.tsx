import { Badge } from '@shared/components/ui/badge';
import { Button } from '@shared/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@shared/components/ui/input-group';
import { Tabs, TabsList, TabsTrigger } from '@shared/components/ui/tabs';
import {
  ExternalLink,
  FolderOpen,
  Link,
  Pencil,
  PlusCircle,
  Puzzle,
  Search,
  Upload,
  XCircle,
} from 'lucide-react';

import { i18nService } from '../../services/i18n';
import { isSkillTab, SkillTab } from './constants';

interface SkillsPageToolbarProps {
  activeTab: SkillTab;
  installedCount: number;
  marketplaceCount: number;
  searchQuery: string;
  isAddMenuOpen: boolean;
  isDownloading: boolean;
  onTabChange: (tab: SkillTab) => void;
  onSearchQueryChange: (value: string) => void;
  onClearSearch: () => void;
  onAddMenuOpenChange: (open: boolean) => void;
  onUploadZip: () => void;
  onUploadFolder: () => void;
  onOpenRemoteImport: () => void;
  onCreateByChat: () => void;
  onOpenMarketplace: () => void;
}

export function SkillsPageToolbar({
  activeTab,
  installedCount,
  marketplaceCount,
  searchQuery,
  isAddMenuOpen,
  isDownloading,
  onTabChange,
  onSearchQueryChange,
  onClearSearch,
  onAddMenuOpenChange,
  onUploadZip,
  onUploadFolder,
  onOpenRemoteImport,
  onCreateByChat,
  onOpenMarketplace,
}: SkillsPageToolbarProps) {
  return (
    <header className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Puzzle className="size-8 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-foreground">{i18nService.t('skills')}</h2>
          <p className="text-sm text-muted-foreground">{i18nService.t('skillsDescription')}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <InputGroup className="flex-1">
          <InputGroupAddon>
            <Search />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            placeholder={i18nService.t('searchSkills')}
            value={searchQuery}
            onChange={event => onSearchQueryChange(event.target.value)}
            aria-label={i18nService.t('searchSkills')}
          />
          {searchQuery && (
            <InputGroupAddon align="inline-end">
              <InputGroupButton
                size="icon-xs"
                aria-label={i18nService.t('clear')}
                onClick={onClearSearch}
              >
                <XCircle />
              </InputGroupButton>
            </InputGroupAddon>
          )}
        </InputGroup>

        <DropdownMenu open={isAddMenuOpen} onOpenChange={onAddMenuOpenChange}>
          <DropdownMenuTrigger render={<Button type="button" variant="outline" />}>
            <PlusCircle data-icon="inline-start" />
            {i18nService.t('addSkill')}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-64">
            <DropdownMenuGroup>
              <DropdownMenuLabel>{i18nService.t('addSkillSecurityTip')}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onUploadZip} disabled={isDownloading}>
                <Upload />
                {i18nService.t('uploadSkillZip')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onUploadFolder} disabled={isDownloading}>
                <FolderOpen />
                {i18nService.t('uploadSkillFolder')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onOpenRemoteImport} disabled={isDownloading}>
                <Link />
                {i18nService.t('remoteImport')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onCreateByChat} disabled={isDownloading}>
                <Pencil />
                {i18nService.t('createSkillByChat')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        {activeTab === SkillTab.Marketplace && (
          <Button type="button" variant="outline" onClick={onOpenMarketplace}>
            <ExternalLink data-icon="inline-start" />
            {i18nService.t('skillMarketplaceOpenExternal')}
          </Button>
        )}
      </div>

      <div className="border-b border-border">
        <Tabs
          value={activeTab}
          onValueChange={value => {
            if (isSkillTab(value)) onTabChange(value);
          }}
          className="-mb-px self-start"
        >
          <TabsList variant="line">
            <TabsTrigger value={SkillTab.Installed} className="after:bottom-[-1px] after:h-1">
              {i18nService.t('skillInstalled')}
              {installedCount > 0 ? <Badge variant="secondary">{installedCount}</Badge> : null}
            </TabsTrigger>
            <TabsTrigger value={SkillTab.Marketplace} className="after:bottom-[-1px] after:h-1">
              {i18nService.t('skillMarketplace')}
              {marketplaceCount > 0 ? <Badge variant="secondary">{marketplaceCount}</Badge> : null}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>
    </header>
  );
}
