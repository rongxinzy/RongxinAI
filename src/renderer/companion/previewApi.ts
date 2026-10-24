import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { CompanionCapability, CompanionRequestState } from '../../shared/companion/constants';
import type {
  CompanionMessage,
  CompanionWindowApi,
  CompanionWindowContext,
  CompanionReceipt,
} from '../../shared/companion/types';

/** DEV browser fixture only. It exercises the window UI, never models or production storage. */
export function createCompanionPreviewApi(): CompanionWindowApi {
  const params = new URLSearchParams(location.search);
  const profiles = Object.values(DesktopPetBuiltinId).map((id, index) => ({
    petId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    personaId: id,
    characterId: id,
    createdAt: 1,
  }));
  let active = profiles[0].petId;
  const messages = new Map<string, CompanionMessage[]>();
  const requests = new Map<string, { receipt: CompanionReceipt; text: string; at: number }>();
  let sequence = 0;
  const context: CompanionWindowContext = {
    language: params.get('language') === 'en' ? 'en' : 'zh',
    theme: params.get('theme') === 'dark' ? 'dark' : 'light',
    themeStyle: '',
  };
  const availability = {
    capability:
      params.get('offline') === '1' ? CompanionCapability.Local : CompanionCapability.Chat,
    modelId: params.get('offline') === '1' ? null : 'preview',
    imageInput: false,
    toolUse: false as const,
  };
  const snapshot = async () => ({
    context,
    activePetId: active,
    profiles,
    availability,
    shortcutAvailable: true,
    conversation: {
      messages: messages.get(active) ?? [],
      pending: requests.get(active)?.receipt ?? null,
    },
  });
  return {
    bootstrap: snapshot,
    select: async id => {
      active = id;
      return snapshot();
    },
    submit: async request => {
      if (availability.capability === CompanionCapability.Local)
        return { availability, receipt: null };
      const receipt = { petId: active, requestId: request.requestId, submissionId: ++sequence };
      messages.set(active, [
        ...(messages.get(active) ?? []),
        { id: ++sequence, role: 'user', text: request.text },
      ]);
      requests.set(active, { receipt, text: request.text, at: Date.now() });
      return { availability, receipt };
    },
    answer: async receipt => {
      const request = requests.get(receipt.petId);
      if (request && Date.now() - request.at < 800)
        return { ...receipt, text: '', state: CompanionRequestState.Accepted };
      if (request) {
        messages.set(receipt.petId, [
          ...(messages.get(receipt.petId) ?? []),
          {
            id: ++sequence,
            role: 'assistant',
            text:
              context.language === 'zh'
                ? '先把最想解决的一件事说给我听。'
                : 'Tell me the first thing you want to work through.',
          },
        ]);
        requests.delete(receipt.petId);
      }
      return { ...receipt, text: '', state: CompanionRequestState.Answered };
    },
    stop: async () => {
      requests.delete(active);
    },
    hide: async () => {
      document.documentElement.dataset.companionHidden = 'true';
    },
    openWorkbench: async () => {
      document.documentElement.dataset.companionWorkbench = 'true';
    },
    onContext: () => () => {},
    onVisibility: () => () => {},
  };
}
