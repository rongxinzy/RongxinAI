import { DesktopPetBuiltinId } from '../desktopPet/catalog';

export const COMPANION_NAME_KEYS = {
  [DesktopPetBuiltinId.Xiaoyuan]: 'companionXiaoyuan',
  [DesktopPetBuiltinId.Youli]: 'companionYouli',
  [DesktopPetBuiltinId.Tuantuan]: 'companionTuantuan',
  [DesktopPetBuiltinId.Mianmian]: 'companionMianmian',
  [DesktopPetBuiltinId.Zhuli]: 'companionZhuli',
  [DesktopPetBuiltinId.Yunmo]: 'companionYunmo',
  [DesktopPetBuiltinId.Maixiao]: 'companionMaixiao',
} as const;

export const CompanionCapability = {
  Local: 'local',
  Chat: 'chat',
} as const;
export type CompanionCapability = (typeof CompanionCapability)[keyof typeof CompanionCapability];

export const CompanionRequestState = {
  Accepted: 'accepted',
  Answered: 'answered',
  Unanswered: 'unanswered',
} as const;
export type CompanionRequestState =
  (typeof CompanionRequestState)[keyof typeof CompanionRequestState];

export const CompanionUnavailableReason = {
  NoModel: 'no_model',
  ModelFailed: 'model_failed',
  ServiceUnavailable: 'service_unavailable',
} as const;
export type CompanionUnavailableReason =
  (typeof CompanionUnavailableReason)[keyof typeof CompanionUnavailableReason];

export const COMPANION_PAGE = 'companion.html';
export const CompanionSurface = { Quick: 'quick', Home: 'home' } as const;
export type CompanionSurface = (typeof CompanionSurface)[keyof typeof CompanionSurface];
export const COMPANION_SHORTCUT = 'CommandOrControl+Shift+Space';

export const CompanionComposerMode = { Chat: 'chat', Task: 'task' } as const;
export type CompanionComposerMode =
  (typeof CompanionComposerMode)[keyof typeof CompanionComposerMode];
