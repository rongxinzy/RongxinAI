import { Button } from '@shared/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@shared/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@shared/components/ui/popover';
import { cn } from '@shared/lib/utils';
import { Brain, Check, ChevronDown, Eye, Globe, Settings2, Wrench } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { ProviderAvatar } from './ProviderAvatar';

export interface ModelPickerItem {
  id: string;
  name: string;
  providerLabel?: string;
  providerKey?: string;
  providerBaseUrl?: string;
  isLocal?: boolean;
  isGroup?: boolean;
  vision?: boolean;
  reasoning?: boolean;
  webSearch?: boolean;
  tools?: boolean;
  contextLabel?: string;
  capabilitiesSummary?: string;
}

export interface ModelPickerLabels {
  searchPlaceholder: string;
  emptyModels: string;
  noMatches: string;
  selectPlaceholder: string;
  currentModelLabel: string;
  recentGroup: string;
  groupsGroup: string;
  localGroup: string;
  otherGroup: string;
  followDefault?: string;
  manageAction?: string;
  visionLabel: string;
  reasoningLabel: string;
  webSearchLabel: string;
  toolsLabel: string;
}

export interface ModelPickerContentProps {
  items: ModelPickerItem[];
  selectedId?: string | null;
  recentIds?: string[];
  allowFollowDefault?: boolean;
  searchQuery: string;
  onSearchQueryChange: (q: string) => void;
  onSelect: (item: ModelPickerItem) => void;
  onSelectFollowDefault?: () => void;
  onManageModels?: () => void;
  topSlot?: ReactNode;
  labels: ModelPickerLabels;
}

function ModelCapabilityIcons({
  item,
  labels,
}: {
  item: ModelPickerItem;
  labels: Pick<
    ModelPickerLabels,
    'visionLabel' | 'reasoningLabel' | 'webSearchLabel' | 'toolsLabel'
  >;
}) {
  return (
    <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
      {item.vision && <Eye className="size-3.5" aria-label={labels.visionLabel} />}
      {item.reasoning && <Brain className="size-3.5" aria-label={labels.reasoningLabel} />}
      {item.webSearch && <Globe className="size-3.5" aria-label={labels.webSearchLabel} />}
      {item.tools && <Wrench className="size-3.5" aria-label={labels.toolsLabel} />}
      {item.contextLabel && (
        <span className="ml-0.5 text-[11px] tabular-nums text-muted-foreground">
          {item.contextLabel}
        </span>
      )}
    </span>
  );
}

export function ModelPickerContent({
  items,
  selectedId,
  recentIds = [],
  allowFollowDefault = false,
  searchQuery,
  onSearchQueryChange,
  onSelect,
  onSelectFollowDefault,
  onManageModels,
  topSlot,
  labels,
}: ModelPickerContentProps) {
  const [hoveredItem, setHoveredItem] = useState<ModelPickerItem | null>(null);
  const query = searchQuery.trim().toLowerCase();

  const matchingItems = useMemo(() => {
    if (!query) return items;
    return items.filter(item => {
      const hay =
        `${item.name} ${item.id} ${item.providerLabel || ''} ${item.providerKey || ''}`.toLowerCase();
      return hay.includes(query);
    });
  }, [items, query]);

  const sections = useMemo(() => {
    if (query) {
      return [{ id: 'matches', heading: labels.otherGroup, items: matchingItems }];
    }

    const recentSet = new Set(recentIds);
    const recent = recentIds
      .map(id => items.find(item => item.id === id))
      .filter((item): item is ModelPickerItem => Boolean(item));
    const groups = items.filter(item => item.isGroup && !recentSet.has(item.id));
    const local = items.filter(item => item.isLocal && !item.isGroup && !recentSet.has(item.id));

    const byProvider = new Map<string, ModelPickerItem[]>();
    for (const item of items) {
      if (item.isGroup || item.isLocal || recentSet.has(item.id)) continue;
      const groupName = item.providerLabel || item.providerKey || labels.otherGroup;
      const list = byProvider.get(groupName) ?? [];
      list.push(item);
      byProvider.set(groupName, list);
    }

    const result: Array<{ id: string; heading: string; items: ModelPickerItem[] }> = [];
    if (recent.length > 0)
      result.push({ id: 'recent', heading: labels.recentGroup, items: recent });
    if (groups.length > 0)
      result.push({ id: 'groups', heading: labels.groupsGroup, items: groups });
    if (local.length > 0) result.push({ id: 'local', heading: labels.localGroup, items: local });
    for (const [heading, list] of byProvider.entries()) {
      result.push({ id: `provider-${heading}`, heading, items: list });
    }
    return result;
  }, [
    items,
    matchingItems,
    query,
    recentIds,
    labels.groupsGroup,
    labels.localGroup,
    labels.otherGroup,
    labels.recentGroup,
  ]);

  const previewSummary =
    hoveredItem?.capabilitiesSummary ||
    items.find(item => item.id === selectedId)?.capabilitiesSummary ||
    '';

  return (
    <Command shouldFilter={false} label={labels.searchPlaceholder}>
      <CommandInput
        placeholder={labels.searchPlaceholder}
        value={searchQuery}
        onValueChange={onSearchQueryChange}
      />
      <CommandList>
        {topSlot}
        {allowFollowDefault && onSelectFollowDefault && !query && (
          <CommandGroup>
            <CommandItem
              value="__follow_default__"
              variant="selector"
              onSelect={() => onSelectFollowDefault()}
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <span className="truncate">{labels.followDefault}</span>
              </span>
              {!selectedId && <Check className="size-4 shrink-0" />}
            </CommandItem>
          </CommandGroup>
        )}
        {items.length === 0 ? (
          <CommandGroup heading={labels.otherGroup}>
            <CommandItem disabled value={labels.emptyModels}>
              {labels.emptyModels}
            </CommandItem>
          </CommandGroup>
        ) : matchingItems.length === 0 ? (
          <CommandEmpty>{labels.noMatches}</CommandEmpty>
        ) : (
          sections.map(section => (
            <CommandGroup key={section.id} heading={section.heading}>
              {section.items.map(item => {
                const isSelected = Boolean(selectedId && item.id === selectedId);
                return (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    variant="selector"
                    aria-label={item.name}
                    aria-description={[
                      item.providerLabel || item.providerKey || '',
                      isSelected ? labels.currentModelLabel : '',
                    ]
                      .filter(Boolean)
                      .join(', ')}
                    onMouseEnter={() => setHoveredItem(item)}
                    onFocus={() => setHoveredItem(item)}
                    onSelect={() => onSelect(item)}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <ProviderAvatar
                        name={item.providerLabel || item.name}
                        providerKey={item.isGroup ? 'group' : item.providerKey}
                        baseUrl={item.isGroup ? undefined : item.providerBaseUrl}
                        size="sm"
                      />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate">{item.name}</span>
                        {(query || section.id === 'recent') && item.providerLabel && (
                          <span className="truncate text-xs text-muted-foreground">
                            {item.providerLabel}
                          </span>
                        )}
                      </span>
                    </span>
                    <ModelCapabilityIcons item={item} labels={labels} />
                    <span
                      aria-hidden="true"
                      className="flex size-4 shrink-0 items-center justify-center"
                    >
                      {isSelected && <Check className="size-4" />}
                    </span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))
        )}
      </CommandList>
      {(previewSummary || onManageModels) && (
        <div className="flex items-center justify-between gap-2 border-t border-border px-2.5 py-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">{previewSummary}</span>
          {onManageModels && labels.manageAction && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0 gap-1"
              onClick={onManageModels}
            >
              <Settings2 className="size-3.5" />
              <span>{labels.manageAction}</span>
            </Button>
          )}
        </div>
      )}
    </Command>
  );
}

export interface ModelPickerProps {
  items: ModelPickerItem[];
  selectedId?: string | null;
  recentIds?: string[];
  allowFollowDefault?: boolean;
  onSelect: (item: ModelPickerItem) => void;
  onSelectFollowDefault?: () => void;
  onManageModels?: () => void;
  labels: ModelPickerLabels;
  disabled?: boolean;
  triggerClassName?: string;
  align?: 'start' | 'end' | 'center';
}

export function ModelPicker({
  items,
  selectedId,
  recentIds,
  allowFollowDefault,
  onSelect,
  onSelectFollowDefault,
  onManageModels,
  labels,
  disabled = false,
  triggerClassName,
  align = 'start',
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const selected = items.find(item => item.id === selectedId);
  const triggerLabel = selected
    ? selected.name
    : allowFollowDefault && labels.followDefault
      ? labels.followDefault
      : labels.selectPlaceholder;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setSearchQuery('');
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        nativeButton={true}
        disabled={disabled}
        render={
          <Button
            type="button"
            variant="outline"
            className={cn('justify-between gap-2', triggerClassName)}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          {selected && (
            <ProviderAvatar
              name={selected.providerLabel || selected.name}
              providerKey={selected.isGroup ? 'group' : selected.providerKey}
              baseUrl={selected.isGroup ? undefined : selected.providerBaseUrl}
              size="sm"
            />
          )}
          <span className="truncate">{triggerLabel}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent align={align} className="w-[340px] p-0">
        <ModelPickerContent
          items={items}
          selectedId={selectedId}
          recentIds={recentIds}
          allowFollowDefault={allowFollowDefault}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onSelect={item => {
            onSelect(item);
            handleOpenChange(false);
          }}
          onSelectFollowDefault={
            onSelectFollowDefault
              ? () => {
                  onSelectFollowDefault();
                  handleOpenChange(false);
                }
              : undefined
          }
          onManageModels={
            onManageModels
              ? () => {
                  handleOpenChange(false);
                  onManageModels();
                }
              : undefined
          }
          labels={labels}
        />
      </PopoverContent>
    </Popover>
  );
}
