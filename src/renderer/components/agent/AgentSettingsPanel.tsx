import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Switch } from '@shared/components/ui/switch';
import { Textarea } from '@shared/components/ui/textarea';
import type { Platform } from '@shared/platform';
import { PlatformRegistry } from '@shared/platform';
import type { AgentTriageOverride } from '@shared/triage';
import { Trash2, X } from 'lucide-react';
import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { useSelector } from 'react-redux';

import { agentService } from '../../services/agent';
import { coworkService } from '../../services/cowork';
import { i18nService } from '../../services/i18n';
import { imService } from '../../services/im';
import { RootState } from '../../store';
import type { Model } from '../../store/slices/modelSlice';
import type { Agent } from '../../types/agent';
import type {
  DingTalkInstanceConfig,
  DingTalkInstanceStatus,
  DiscordInstanceConfig,
  DiscordInstanceStatus,
  FeishuInstanceConfig,
  FeishuInstanceStatus,
  IMGatewayConfig,
  IMGatewayStatus,
  QQInstanceConfig,
  QQInstanceStatus,
  TelegramInstanceConfig,
  TelegramInstanceStatus,
  WecomInstanceConfig,
  WecomInstanceStatus,
} from '../../types/im';
import {
  getAgentDisplayName,
  getAgentDisplayNameById,
  isDefaultAgentId,
} from '../../utils/agentDisplay';
import { isModelSelectableForOpenClaw } from '../../utils/llamacppOpenClawEligibility';
import { toOpenClawModelRef } from '../../utils/openclawModelRef';
import {
  buildOpenClawModelValidationTargets,
  OpenClawModelSupportReason,
  resolveDraftOpenClawModelRef,
  resolveFirstUnsupportedOpenClawModel,
  resolveOpenClawModelSupportMessageKey,
  resolveOpenClawModelSupportResult,
} from '../../utils/openclawModelSupport';
import { getVisibleIMPlatforms } from '../../utils/regionFilter';
import Modal from '../common/Modal';
import { isLlamaCppModelRef } from '../cowork/agentModelSelection';
import AgentAvatarPicker from './AgentAvatarPicker';
import AgentConfirmDialog from './AgentConfirmDialog';
import AgentDetailToolbar from './AgentDetailToolbar';
import AgentSkillSelector from './AgentSkillSelector';
import { AgentConfirmDialogVariant, AgentDetailTab } from './constants';

type MultiInstancePlatform = 'dingtalk' | 'feishu' | 'qq' | 'wecom' | 'telegram' | 'discord';
type MultiInstanceConfig =
  | DingTalkInstanceConfig
  | FeishuInstanceConfig
  | QQInstanceConfig
  | WecomInstanceConfig
  | TelegramInstanceConfig
  | DiscordInstanceConfig;
type MultiInstanceStatus =
  | DingTalkInstanceStatus
  | FeishuInstanceStatus
  | QQInstanceStatus
  | WecomInstanceStatus
  | TelegramInstanceStatus
  | DiscordInstanceStatus;

const MULTI_INSTANCE_PLATFORMS: MultiInstancePlatform[] = [
  'dingtalk',
  'feishu',
  'qq',
  'wecom',
  'telegram',
  'discord',
];

const isMultiInstancePlatform = (platform: Platform): platform is MultiInstancePlatform =>
  MULTI_INSTANCE_PLATFORMS.includes(platform as MultiInstancePlatform);

interface AgentSettingsPanelProps {
  agentId: string | null;
  onClose: () => void;
}

const AgentSettingsPanel: React.FC<AgentSettingsPanelProps> = ({ agentId, onClose }) => {
  const agents = useSelector((state: RootState) => state.agent.agents);
  const imStatus = useSelector((state: RootState) => state.im.status);
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const defaultSelectedModel = useSelector((state: RootState) => state.model.defaultSelectedModel);
  const [, setAgent] = useState<Agent | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [identity, setIdentity] = useState('');
  const [userInfo, setUserInfo] = useState('');
  const [icon, setIcon] = useState('');
  const [model, setModel] = useState<Model | null>(null);
  const [workingDirectory, setWorkingDirectory] = useState('');
  const [skillIds, setSkillIds] = useState<string[]>([]);
  const [nameTouched, setNameTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showUnsavedConfirm, setShowUnsavedConfirm] = useState(false);
  const [activeTab, setActiveTab] = useState<AgentDetailTab>(AgentDetailTab.Prompt);

  // Agent triage state — useReducer to avoid races
  const [triageCustom, setTriageCustom] = useState(false);
  const triageReducer = (s: AgentTriageOverride, a: Partial<AgentTriageOverride>) => ({
    ...s,
    ...a,
  });
  const [triageOverride, dispatchTriage] = useReducer(triageReducer, {});
  const initialTriageRef = useRef<AgentTriageOverride | null>(null);

  // IM binding state — keys are 'telegram' (single) or 'dingtalk:<instanceId>' (multi)
  const [imConfig, setImConfig] = useState<IMGatewayConfig | null>(null);
  const [boundKeys, setBoundKeys] = useState<Set<string>>(new Set());
  const [initialBoundKeys, setInitialBoundKeys] = useState<Set<string>>(new Set());
  const isMainAgent = isDefaultAgentId(agentId);

  // Snapshot of initial values for dirty detection
  const initialValuesRef = useRef({
    name: '',
    description: '',
    systemPrompt: '',
    identity: '',
    userInfo: '',
    icon: '',
    model: '',
    workingDirectory: '',
    skillIds: [] as string[],
  });

  useEffect(() => {
    if (!agentId) return;
    let cancelled = false;
    setActiveTab(AgentDetailTab.Identity);
    setShowDeleteConfirm(false);
    setShowUnsavedConfirm(false);
    setNameTouched(false);

    void (async () => {
      const a = await window.electron?.agents?.get(agentId);
      if (!a || cancelled) return;

      let nextSystemPrompt = a.systemPrompt;
      let nextIdentity = a.identity;
      const nextUserInfo = await coworkService.readBootstrapFile('USER.md');
      if (cancelled) return;
      if (isDefaultAgentId(agentId)) {
        const [mainIdentity, mainSoul] = await Promise.all([
          coworkService.readBootstrapFile('IDENTITY.md'),
          coworkService.readBootstrapFile('SOUL.md'),
        ]);
        if (cancelled) return;
        nextSystemPrompt = mainSoul;
        nextIdentity = mainIdentity;
      }

      setAgent(a);
      setName(a.name);
      setDescription(a.description);
      setSystemPrompt(nextSystemPrompt);
      setIdentity(nextIdentity);
      setUserInfo(nextUserInfo);
      setIcon(a.icon);
      const resolvedModel = a.model
        ? (availableModels.find(candidate => toOpenClawModelRef(candidate) === a.model) ?? null)
        : null;
      setModel(
        resolvedModel ??
          (isLlamaCppModelRef(a.model)
            ? ({ id: '__invalid__', name: a.model.split('/').pop() || a.model } as Model)
            : null),
      );
      setWorkingDirectory(a.workingDirectory ?? '');
      setSkillIds(a.skillIds ?? []);
      // Load triage override
      const loadedTriage = a.triageOverride ?? {};
      dispatchTriage({
        enabled: undefined,
        lightModelRef: undefined,
        heavyModelRef: undefined,
        allowCrossProviderSwitch: undefined,
        ...loadedTriage,
      });
      setTriageCustom(
        Boolean(
          loadedTriage.enabled !== undefined ||
          loadedTriage.lightModelRef ||
          loadedTriage.heavyModelRef ||
          loadedTriage.allowCrossProviderSwitch !== undefined,
        ),
      );
      initialTriageRef.current = loadedTriage;
      initialValuesRef.current = {
        name: a.name,
        description: a.description,
        systemPrompt: nextSystemPrompt,
        identity: nextIdentity,
        userInfo: nextUserInfo,
        icon: a.icon,
        model: a.model ?? '',
        workingDirectory: a.workingDirectory ?? '',
        skillIds: a.skillIds ?? [],
      };
    })();

    // Load IM config and status for bindings
    imService.loadConfig().then(cfg => {
      if (cfg && !cancelled) {
        setImConfig(cfg);
        const bindings = cfg.settings?.platformAgentBindings || {};
        const bound = new Set<string>();
        for (const [key, boundAgentId] of Object.entries(bindings)) {
          if (boundAgentId === agentId) {
            bound.add(key);
          }
        }
        setBoundKeys(bound);
        setInitialBoundKeys(new Set(bound));
      }
    });
    void imService.loadStatus();
    return () => {
      cancelled = true;
    };
  }, [agentId, availableModels]);

  const isDirty = useCallback((): boolean => {
    const init = initialValuesRef.current;
    if (name !== init.name) return true;
    if (description !== init.description) return true;
    if (systemPrompt !== init.systemPrompt) return true;
    if (identity !== init.identity) return true;
    if (userInfo !== init.userInfo) return true;
    if (icon !== init.icon) return true;
    if ((model ? toOpenClawModelRef(model) : '') !== init.model) return true;
    if (workingDirectory !== init.workingDirectory) return true;
    if (
      skillIds.length !== init.skillIds.length ||
      skillIds.some((id, i) => id !== init.skillIds[i])
    )
      return true;
    if (
      boundKeys.size !== initialBoundKeys.size ||
      [...boundKeys].some(k => !initialBoundKeys.has(k))
    )
      return true;
    const currentTriage = triageCustom
      ? {
          ...triageOverride,
          ...(triageOverride.enabled === undefined ? {} : { enabled: triageOverride.enabled }),
        }
      : {};
    const prevTriage =
      initialTriageRef.current && Object.keys(initialTriageRef.current).length > 0
        ? initialTriageRef.current
        : {};
    if (JSON.stringify(currentTriage) !== JSON.stringify(prevTriage)) return true;
    return false;
  }, [
    name,
    description,
    systemPrompt,
    identity,
    userInfo,
    icon,
    model,
    workingDirectory,
    skillIds,
    boundKeys,
    initialBoundKeys,
    triageCustom,
    triageOverride,
  ]);

  if (!agentId) return null;

  const handleClose = () => {
    if (isDirty()) {
      setShowUnsavedConfirm(true);
    } else {
      onClose();
    }
  };

  const handleConfirmDiscard = () => {
    setShowUnsavedConfirm(false);
    onClose();
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    const selectedModelRef = resolveDraftOpenClawModelRef(model, initialValuesRef.current.model);
    const defaultModelRef = defaultSelectedModel ? toOpenClawModelRef(defaultSelectedModel) : '';
    if (boundKeys.size > 0) {
      const unsupportedModel = resolveFirstUnsupportedOpenClawModel(
        buildOpenClawModelValidationTargets({
          primaryModelRef: selectedModelRef,
          fallbackModelRef: defaultModelRef,
          triageOverride: triageCustom ? triageOverride : null,
        }),
        availableModels,
      );
      if (unsupportedModel) {
        window.dispatchEvent(
          new CustomEvent('app:showToast', {
            detail: i18nService.t(resolveOpenClawModelSupportMessageKey(unsupportedModel.reason)),
          }),
        );
        return;
      }
    }
    setSaving(true);
    try {
      const result = await agentService.updateAgent(agentId, {
        name: name.trim(),
        description: description.trim(),
        systemPrompt: systemPrompt.trim(),
        identity: identity.trim(),
        model: selectedModelRef,
        workingDirectory: workingDirectory.trim(),
        icon: icon.trim(),
        skillIds,
        triageOverride: triageCustom ? triageOverride : null,
      });
      if (!result) {
        window.dispatchEvent(
          new CustomEvent('app:showToast', { detail: i18nService.t('agentSaveFailed') }),
        );
        return;
      }
      const bootstrapWrites = isMainAgent
        ? [
            coworkService.writeBootstrapFile('IDENTITY.md', identity),
            coworkService.writeBootstrapFile('SOUL.md', systemPrompt),
            coworkService.writeBootstrapFile('USER.md', userInfo),
          ]
        : [coworkService.writeBootstrapFile('USER.md', userInfo)];
      if (bootstrapWrites.length > 0) {
        const bootstrapSaved = await Promise.all(bootstrapWrites);
        if (bootstrapSaved.some(saved => !saved)) {
          window.dispatchEvent(
            new CustomEvent('app:showToast', { detail: i18nService.t('agentSaveFailed') }),
          );
          return;
        }
      }
      // Persist IM bindings if changed
      const bindingsChanged =
        boundKeys.size !== initialBoundKeys.size ||
        [...boundKeys].some(k => !initialBoundKeys.has(k));
      if (bindingsChanged && imConfig) {
        const currentBindings = { ...(imConfig.settings?.platformAgentBindings || {}) };
        // Remove old bindings for this agent
        for (const key of Object.keys(currentBindings)) {
          if (currentBindings[key] === agentId) {
            delete currentBindings[key];
          }
        }
        // The main agent is the implicit default, so explicit main bindings are unnecessary.
        if (!isMainAgent) {
          for (const key of boundKeys) {
            currentBindings[key] = agentId;
          }
        }
        await imService.persistConfig({
          settings: { ...imConfig.settings, platformAgentBindings: currentBindings },
        });
        await imService.saveAndSyncConfig();
      }
      onClose();
    } catch {
      window.dispatchEvent(
        new CustomEvent('app:showToast', { detail: i18nService.t('agentSaveFailed') }),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const success = await agentService.deleteAgent(agentId);
    if (success) {
      setShowDeleteConfirm(false);
      onClose();
    }
  };

  const handleToggleIMBinding = (key: string) => {
    const next = new Set(boundKeys);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    setBoundKeys(next);
  };

  /** Check if a multi-instance platform has any enabled+connected instances */
  const getConnectedInstances = (platform: MultiInstancePlatform) => {
    if (!imConfig) return [];
    const cfg = imConfig[platform];
    const instances = cfg?.instances;
    if (!Array.isArray(instances)) return [];
    const statusInstances = (imStatus as IMGatewayStatus | undefined)?.[platform]?.instances;
    return instances.filter((inst: MultiInstanceConfig) => {
      if (!inst.enabled) return false;
      const instStatus = Array.isArray(statusInstances)
        ? statusInstances.find((s: MultiInstanceStatus) => s.instanceId === inst.instanceId)
        : null;
      return instStatus?.connected === true;
    });
  };

  const isPlatformConfigured = (platform: Platform): boolean => {
    if (!imConfig) return false;
    if (isMultiInstancePlatform(platform)) {
      return getConnectedInstances(platform).length > 0;
    }
    const cfg = imConfig[platform as keyof typeof imConfig];
    if (!cfg || typeof cfg !== 'object') return false;
    return 'enabled' in cfg && (cfg as { enabled: boolean }).enabled === true;
  };

  /** Resolve agent name by id */
  const getAgentName = (aid: string): string | null => {
    return getAgentDisplayNameById(aid, agents);
  };

  const nameInputValue =
    isMainAgent && !nameTouched ? getAgentDisplayName({ id: agentId, name }) : name;

  const tabs: { key: AgentDetailTab; label: string }[] = [
    { key: AgentDetailTab.Identity, label: i18nService.t('coworkBootstrapIdentityTitle') },
    { key: AgentDetailTab.Prompt, label: i18nService.t('coworkBootstrapSoulTitle') },
    { key: AgentDetailTab.User, label: i18nService.t('coworkBootstrapUserTitle') },
    { key: AgentDetailTab.Skills, label: i18nService.t('agentTabSkills') },
    { key: AgentDetailTab.Im, label: i18nService.t('agentTabIM') },
    { key: AgentDetailTab.Triage, label: i18nService.t('agentTabTriage') },
  ];

  const renderTextEditor = (
    value: string,
    onChange: (value: string) => void,
    placeholder: string,
    ariaLabel: string,
    hint?: string,
  ) => (
    <div className="flex h-full min-h-0 flex-col gap-2">
      {hint && <p className="shrink-0 text-xs leading-5 text-muted-foreground">{hint}</p>}
      <Textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="min-h-0 flex-1 resize-none border-transparent bg-transparent text-sm leading-6 text-foreground placeholder:text-muted-foreground/45 focus-visible:ring-0"
      />
    </div>
  );

  const renderToggle = (isOn: boolean) => (
    <div
      className={`relative w-9 h-5 rounded-full transition-colors ${
        isOn ? 'bg-primary' : 'bg-gray-300 dark:bg-gray-600'
      }`}
    >
      <div
        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
          isOn ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </div>
  );

  const renderMultiInstancePlatform = (platform: MultiInstancePlatform) => {
    const connectedInstances = getConnectedInstances(platform);
    const logo = PlatformRegistry.logo(platform);
    const bindings = imConfig?.settings?.platformAgentBindings || {};

    if (connectedInstances.length === 0) {
      // No connected instances — show disabled row like single-instance unconfigured
      return (
        <div
          key={platform}
          className="flex items-center justify-between px-3 py-2.5 rounded-lg opacity-50"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center">
              <img
                src={logo}
                alt={i18nService.t(platform)}
                className="w-6 h-6 object-contain rounded"
              />
            </div>
            <div>
              <div className="text-sm font-medium text-foreground">{i18nService.t(platform)}</div>
              <div className="text-xs text-muted-foreground/50">
                {i18nService.t('agentIMNotConfiguredHint') ||
                  'Please configure in Settings > IM Bots first'}
              </div>
            </div>
          </div>
          <span className="text-xs text-muted-foreground/50">
            {i18nService.t('agentIMNotConfigured') || 'Not configured'}
          </span>
        </div>
      );
    }

    return (
      <div key={platform} className="rounded-lg border border-border overflow-hidden">
        {/* Platform header */}
        <div className="flex items-center gap-3 px-3 py-2.5 bg-surface-raised">
          <div className="flex h-8 w-8 items-center justify-center">
            <img
              src={logo}
              alt={i18nService.t(platform)}
              className="w-6 h-6 object-contain rounded"
            />
          </div>
          <span className="text-sm font-semibold text-foreground">{i18nService.t(platform)}</span>
        </div>
        {/* Instance list */}
        {connectedInstances.map((inst: MultiInstanceConfig, idx: number) => {
          const bindingKey = `${platform}:${inst.instanceId}`;
          const otherAgentId = bindings[bindingKey];
          const boundToOther = Boolean(otherAgentId && otherAgentId !== agentId);
          const canToggle = !isMainAgent && !boundToOther;
          const isBound = isMainAgent ? !boundToOther : boundKeys.has(bindingKey);
          const otherAgentName = boundToOther ? getAgentName(otherAgentId ?? '') : null;

          return (
            <div
              key={inst.instanceId}
              className={`flex items-center justify-between px-3 py-2 pl-14 transition-colors ${
                idx < connectedInstances.length - 1 ? 'border-b border-border-subtle' : ''
              } ${canToggle ? 'cursor-pointer hover:bg-surface-raised' : ''} ${boundToOther ? 'opacity-55' : ''}`}
              onClick={() => canToggle && handleToggleIMBinding(bindingKey)}
            >
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                <span className="text-sm text-foreground">{inst.instanceName}</span>
                {boundToOther && otherAgentName && (
                  <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
                    {(i18nService.t('agentIMBoundToOther') || '→ {agent}').replace(
                      '{agent}',
                      otherAgentName,
                    )}
                  </span>
                )}
              </div>
              {boundToOther ? <div className="w-9 h-5" /> : renderToggle(isBound)}
            </div>
          );
        })}
      </div>
    );
  };

  const renderSingleInstancePlatform = (platform: Platform) => {
    const logo = PlatformRegistry.logo(platform);
    const configured = isPlatformConfigured(platform);
    const bindings = imConfig?.settings?.platformAgentBindings || {};
    const otherAgentId = bindings[platform];
    const boundToOther = Boolean(configured && otherAgentId && otherAgentId !== agentId);
    const canToggle = configured && !boundToOther && !isMainAgent;
    const isBound = isMainAgent ? configured && !boundToOther : boundKeys.has(platform);
    const otherAgentName = boundToOther ? getAgentName(otherAgentId ?? '') : null;

    return (
      <div
        key={platform}
        className={`flex items-center justify-between px-3 py-2.5 rounded-lg transition-colors ${
          !configured
            ? 'opacity-50'
            : boundToOther
              ? 'opacity-55'
              : canToggle
                ? 'hover:bg-surface-raised cursor-pointer'
                : ''
        }`}
        onClick={() => canToggle && handleToggleIMBinding(platform)}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center">
            <img
              src={logo}
              alt={i18nService.t(platform)}
              className="w-6 h-6 object-contain rounded"
            />
          </div>
          <div>
            <div className="text-sm font-medium text-foreground">{i18nService.t(platform)}</div>
            {!configured && (
              <div className="text-xs text-muted-foreground/50">
                {i18nService.t('agentIMNotConfiguredHint') ||
                  'Please configure in Settings > IM Bots first'}
              </div>
            )}
          </div>
          {boundToOther && otherAgentName && (
            <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded">
              {(i18nService.t('agentIMBoundToOther') || '→ {agent}').replace(
                '{agent}',
                otherAgentName,
              )}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {configured ? (
            boundToOther ? (
              <div className="w-9 h-5" />
            ) : (
              renderToggle(isBound)
            )
          ) : (
            <span className="text-xs text-muted-foreground/50">
              {i18nService.t('agentIMNotConfigured') || 'Not configured'}
            </span>
          )}
        </div>
      </div>
    );
  };

  const triageLightModelSupport = resolveOpenClawModelSupportResult(
    triageOverride.lightModelRef ?? '',
    availableModels,
  );
  const triageHeavyModelSupport = resolveOpenClawModelSupportResult(
    triageOverride.heavyModelRef ?? '',
    availableModels,
  );
  const triageLightModelIneligible =
    triageLightModelSupport.reason !== OpenClawModelSupportReason.Supported;
  const triageHeavyModelIneligible =
    triageHeavyModelSupport.reason !== OpenClawModelSupportReason.Supported;

  return (
    <>
      <Modal
        onClose={handleClose}
        overlayClassName="fixed inset-0 z-50 flex items-center justify-center bg-black/10 dark:bg-black/50"
        className="w-[calc(100vw-56px)] max-w-[854px]! h-[88vh] max-h-[720px] flex flex-col overflow-hidden rounded-xl bg-background shadow-2xl p-0 gap-0 ring-0"
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border bg-surface/40 px-4 py-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <AgentAvatarPicker value={icon} onChange={setIcon} />
            <div className="min-w-0 flex-1 pt-0.5">
              <Input
                type="text"
                value={nameInputValue}
                onChange={e => {
                  setNameTouched(true);
                  setName(e.target.value);
                }}
                placeholder={i18nService.t('agentNamePlaceholder')}
                aria-label={i18nService.t('agentName')}
                className="w-full border-0 bg-transparent text-lg font-semibold leading-6 text-foreground placeholder:text-muted-foreground/40 focus-visible:ring-0"
              />
              <Input
                type="text"
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder={i18nService.t('agentDescriptionPlaceholder')}
                aria-label={i18nService.t('agentDescription')}
                className="mt-0.5 w-full border-0 bg-transparent text-sm leading-5 text-muted-foreground placeholder:text-muted-foreground/50 focus-visible:ring-0"
              />
            </div>
          </div>
          <Button type="button" variant="ghost" size="icon" onClick={handleClose} className="mt-1">
            <X className="h-5 w-5 text-muted-foreground" />
          </Button>
        </div>

        {/* Tab bar */}
        <div className="flex shrink-0 border-b border-border px-4">
          {tabs.map(tab => (
            <Button
              key={tab.key}
              type="button"
              variant="ghost"
              onClick={() => setActiveTab(tab.key)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
              {activeTab === tab.key && (
                <div className="absolute -bottom-px left-0 right-0 h-0.5 bg-foreground rounded-full" />
              )}
            </Button>
          ))}
        </div>

        {/* Tab content */}
        <div className="px-4 py-3 overflow-y-auto flex-1 min-h-0">
          {activeTab === AgentDetailTab.Prompt &&
            renderTextEditor(
              systemPrompt,
              setSystemPrompt,
              i18nService.t('coworkBootstrapPlaceholder'),
              i18nService.t('coworkBootstrapSoulTitle'),
              i18nService.t('coworkBootstrapSoulHint'),
            )}

          {activeTab === AgentDetailTab.Identity &&
            renderTextEditor(
              identity,
              setIdentity,
              i18nService.t('coworkBootstrapPlaceholder'),
              i18nService.t('coworkBootstrapIdentityTitle'),
              i18nService.t('coworkBootstrapIdentityHint'),
            )}

          {activeTab === AgentDetailTab.User &&
            renderTextEditor(
              userInfo,
              setUserInfo,
              i18nService.t('coworkBootstrapPlaceholder'),
              i18nService.t('coworkBootstrapUserTitle'),
              i18nService.t('coworkBootstrapUserHint'),
            )}

          {activeTab === AgentDetailTab.Skills && (
            <AgentSkillSelector selectedSkillIds={skillIds} onChange={setSkillIds} />
          )}

          {activeTab === AgentDetailTab.Im && (
            <div className="h-full overflow-y-auto">
              <div className="space-y-1">
                {PlatformRegistry.platforms
                  .filter(platform =>
                    (
                      getVisibleIMPlatforms(i18nService.getLanguage()) as readonly string[]
                    ).includes(platform),
                  )
                  .map(platform => {
                    if (isMultiInstancePlatform(platform)) {
                      return renderMultiInstancePlatform(platform);
                    }
                    return renderSingleInstancePlatform(platform);
                  })}
              </div>
            </div>
          )}

          {activeTab === AgentDetailTab.Triage && (
            <div className="h-full overflow-y-auto">
              <div className="space-y-4">
                {/* Enable toggle */}
                <div className="flex items-center justify-between rounded-lg border border-border bg-surface/60 p-3">
                  <div>
                    <span className="text-sm font-medium text-foreground">
                      {i18nService.t('agentTriageEnable')}
                    </span>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {i18nService.t('agentTriageEnableHint')}
                    </p>
                  </div>
                  <Switch
                    checked={!!triageOverride.enabled}
                    onCheckedChange={checked => {
                      setTriageCustom(true);
                      dispatchTriage({ enabled: checked });
                    }}
                  />
                </div>

                {triageOverride.enabled && (
                  <div className="space-y-4">
                    {/* Tier overview */}
                    <div className="rounded-lg border border-border bg-surface/40 p-3 space-y-2">
                      <h4 className="text-sm font-medium text-foreground">路由策略</h4>
                      <div className="space-y-2">
                        <div className="flex items-start gap-2">
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-green-500/15 text-[10px] font-medium text-green-600">
                            轻
                          </span>
                          <div className="text-xs text-muted-foreground">
                            {i18nService.t('agentTriageLightModelHint')}
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-blue-500/15 text-[10px] font-medium text-blue-600">
                            标
                          </span>
                          <div className="text-xs text-muted-foreground">
                            {i18nService.t('agentTriageStandardNote')}
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded bg-red-500/15 text-[10px] font-medium text-red-600">
                            强
                          </span>
                          <div className="text-xs text-muted-foreground">
                            {i18nService.t('agentTriageHeavyModelHint')}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Light model */}
                    <div>
                      <label className="text-sm font-medium text-foreground block mb-1">
                        {i18nService.t('agentTriageLightModel')}
                      </label>
                      <Select
                        value={triageOverride.lightModelRef || undefined}
                        onValueChange={value =>
                          dispatchTriage({ lightModelRef: value || undefined })
                        }
                      >
                        <SelectTrigger className="w-full text-sm border-border bg-surface text-foreground">
                          <SelectValue placeholder="不指定（使用 Agent 默认模型）" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">不指定（使用 Agent 默认模型）</SelectItem>
                          {availableModels.map(m => {
                            const ref = `${m.providerKey || 'unknown'}/${m.id}`;
                            return (
                              <SelectItem
                                key={ref}
                                value={ref}
                                disabled={!isModelSelectableForOpenClaw(m)}
                              >
                                {m.name || m.id}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      {triageLightModelIneligible && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {i18nService.t(
                            resolveOpenClawModelSupportMessageKey(triageLightModelSupport.reason),
                          )}
                        </p>
                      )}
                    </div>

                    {/* Heavy model */}
                    <div>
                      <label className="text-sm font-medium text-foreground block mb-1">
                        {i18nService.t('agentTriageHeavyModel')}
                      </label>
                      <Select
                        value={triageOverride.heavyModelRef || undefined}
                        onValueChange={value =>
                          dispatchTriage({ heavyModelRef: value || undefined })
                        }
                      >
                        <SelectTrigger className="w-full text-sm border-border bg-surface text-foreground">
                          <SelectValue placeholder="不指定（使用 Agent 默认模型）" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="">不指定（使用 Agent 默认模型）</SelectItem>
                          {availableModels.map(m => {
                            const ref = `${m.providerKey || 'unknown'}/${m.id}`;
                            return (
                              <SelectItem
                                key={ref}
                                value={ref}
                                disabled={!isModelSelectableForOpenClaw(m)}
                              >
                                {m.name || m.id}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      {triageHeavyModelIneligible && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {i18nService.t(
                            resolveOpenClawModelSupportMessageKey(triageHeavyModelSupport.reason),
                          )}
                        </p>
                      )}
                    </div>

                    {/* Cross provider */}
                    <label className="flex items-center justify-between">
                      <span className="text-sm text-foreground">
                        {i18nService.t('agentTriageCrossProvider')}
                      </span>
                      <Switch
                        checked={!!triageOverride.allowCrossProviderSwitch}
                        onCheckedChange={checked =>
                          dispatchTriage({ allowCrossProviderSwitch: checked })
                        }
                      />
                    </label>

                    {triageOverride.allowCrossProviderSwitch && (
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        跨服务商切换可能导致对话数据发送到第三方服务器，请确认您信任目标服务商。
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <AgentDetailToolbar
            model={model}
            onModelChange={setModel}
            workingDirectory={workingDirectory}
            onWorkingDirectoryChange={setWorkingDirectory}
          />
          <div className="flex shrink-0 gap-2">
            {!isMainAgent && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setShowDeleteConfirm(true)}
                className="inline-flex h-9 items-center gap-1.5"
              >
                <Trash2 className="h-4 w-4" />
                {i18nService.t('delete')}
              </Button>
            )}
            <Button
              type="button"
              onClick={handleSave}
              disabled={!name.trim() || saving}
              className="h-9 px-5"
            >
              {saving ? i18nService.t('saving') : i18nService.t('save')}
            </Button>
          </div>
        </div>
      </Modal>

      {showDeleteConfirm && (
        <AgentConfirmDialog
          variant={AgentConfirmDialogVariant.Delete}
          title={i18nService.t('agentDeleteConfirmTitle')}
          message={i18nService.t('agentDeleteConfirmMessage').replace('{name}', name)}
          cancelLabel={i18nService.t('cancel')}
          confirmLabel={i18nService.t('delete')}
          onCancel={() => setShowDeleteConfirm(false)}
          onConfirm={handleDelete}
        />
      )}

      {showUnsavedConfirm && (
        <AgentConfirmDialog
          variant={AgentConfirmDialogVariant.Unsaved}
          title={i18nService.t('agentUnsavedTitle')}
          message={i18nService.t('agentUnsavedMessage')}
          cancelLabel={i18nService.t('agentUnsavedStay')}
          confirmLabel={i18nService.t('agentUnsavedDiscard')}
          onCancel={() => setShowUnsavedConfirm(false)}
          onConfirm={handleConfirmDiscard}
        />
      )}
    </>
  );
};

export default AgentSettingsPanel;
