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
import { FolderOpen, Link, Pencil, PlusCircle, Search, Upload, XCircle } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import { isSkillTab, SkillTab } from './constants';

interface SkillsPageToolbarProps {
  activeTab: SkillTab;
  installedCount: number;
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
}

export function SkillsPageToolbar({
  activeTab,
  installedCount,
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
}: SkillsPageToolbarProps) {
  const isMarketplace = activeTab === SkillTab.Marketplace;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Tabs
          value={activeTab}
          onValueChange={value => {
            if (isSkillTab(value)) {
              onTabChange(value);
            }
          }}
          className="shrink-0"
        >
          <TabsList>
            <TabsTrigger value={SkillTab.Installed}>
              {i18nService.t('skillInstalled')}
              <Badge variant="secondary">{installedCount}</Badge>
            </TabsTrigger>
            <TabsTrigger value={SkillTab.Marketplace}>
              {i18nService.t('skillMarketplace')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {isMarketplace && (
        <div className="flex flex-col gap-2 sm:flex-row">
          <InputGroup>
            <InputGroupInput
              type="search"
              placeholder={i18nService.t('searchSkills')}
              value={searchQuery}
              onChange={event => onSearchQueryChange(event.target.value)}
              aria-label={i18nService.t('searchSkills')}
            />
            <InputGroupAddon>
              <Search />
            </InputGroupAddon>
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
        </div>
      )}
    </div>
  );
}
