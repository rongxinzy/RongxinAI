import type {
  CodingAgentAvailableCommand,
  CodingAgentCapabilities,
  CodingAgentConfigOption,
  CodingAgentConfigOptionValue,
} from '../../../shared/codingAgent';
import { asRecord, DEFAULT_CAPABILITIES, type AcpInitializeResult } from './acpDriverSupport';

/** Projects an ACP initialize result onto the driver capability surface. */
export const normalizeCapabilities = (result: AcpInitializeResult): CodingAgentCapabilities => {
  const capabilities = result.agentCapabilities ?? result.capabilities ?? {};
  const sessionCapabilities = asRecord(capabilities.sessionCapabilities);
  const promptCapabilities = asRecord(capabilities.promptCapabilities);
  return {
    ...DEFAULT_CAPABILITIES,
    supportsLoadSession: capabilities.loadSession === true,
    supportsResumeSession: Boolean(sessionCapabilities.resume),
    // ACP advertises these as client capabilities or session updates, not agent capabilities.
    // The driver implements them locally and accepts updates opportunistically.
    supportsPlans: true,
    supportsPermissions: true,
    supportsFilesystem: true,
    supportsTerminal: true,
    supportsConfigOptions: false,
    supportsUsage: true,
    supportsElicitation: false,
    supportsPromptImages: promptCapabilities.image === true,
    supportsEmbeddedContext: promptCapabilities.embeddedContext === true,
  };
};

/** Keeps only protocol-declared, well-formed session configuration options. */
export const normalizeConfigOptions = (value: unknown): CodingAgentConfigOption[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    const option = asRecord(item);
    const type = option.type;
    const currentValue = option.currentValue;
    if (
      typeof option.id !== 'string' ||
      typeof option.name !== 'string' ||
      (type !== 'select' && type !== 'boolean') ||
      (typeof currentValue !== 'string' && typeof currentValue !== 'boolean')
    ) {
      return [];
    }
    if (type === 'boolean' && typeof currentValue !== 'boolean') return [];
    const options =
      type === 'select'
        ? (Array.isArray(option.options) ? option.options : []).flatMap(configValue => {
            const parsed = asRecord(configValue);
            if (typeof parsed.value !== 'string' || typeof parsed.name !== 'string') return [];
            return [
              {
                value: parsed.value,
                name: parsed.name,
                ...(typeof parsed.description === 'string'
                  ? { description: parsed.description }
                  : {}),
              } satisfies CodingAgentConfigOptionValue,
            ];
          })
        : undefined;
    if (type === 'select' && !options?.some(optionValue => optionValue.value === currentValue)) {
      return [];
    }
    return [
      {
        id: option.id,
        name: option.name,
        ...(typeof option.description === 'string' ? { description: option.description } : {}),
        ...(typeof option.category === 'string' ? { category: option.category } : {}),
        type,
        currentValue,
        ...(options ? { options } : {}),
      } satisfies CodingAgentConfigOption,
    ];
  });
};

/** Keeps only well-formed slash commands and de-duplicates them by name. */
export const normalizeAvailableCommands = (value: unknown): CodingAgentAvailableCommand[] => {
  if (!Array.isArray(value)) return [];
  const commands = new Map<string, CodingAgentAvailableCommand>();
  for (const item of value) {
    const command = asRecord(item);
    const name = typeof command.name === 'string' ? command.name.trim().replace(/^\/+/, '') : '';
    if (!name || /\s/.test(name) || typeof command.description !== 'string') continue;
    const input = asRecord(command.input);
    const meta = asRecord(command._meta);
    commands.set(name, {
      name,
      description: command.description,
      ...(typeof input.hint === 'string' ? { input: { hint: input.hint } } : {}),
      ...(Object.keys(meta).length > 0 ? { _meta: meta } : {}),
    });
  }
  return [...commands.values()];
};
