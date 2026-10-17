import type { ReactNode } from 'react';

import type { CoworkPermissionMode } from '../../../../shared/cowork/constants';
import type { DraftAttachment } from '../../../store/slices/coworkSlice';
import type { CoworkFileAttachment, CoworkImageAttachment } from '../../../types/cowork';

// CoworkAttachment is aliased from the Redux-persisted DraftAttachment type
// so that attachment state survives view switches (cowork ↔ skills, etc.)
export type CoworkAttachment = DraftAttachment;

export interface CoworkPromptInputRef {
  /** 设置输入框值 */
  setValue: (value: string) => void;
  /** 设置图片附件（用于重新编辑消息时还原图片） */
  setImageAttachments: (images: CoworkImageAttachment[]) => void;
  /** 聚焦输入框 */
  focus: () => void;
}

export interface CoworkPromptInputProps {
  onSubmit: (
    prompt: string,
    imageAttachments?: CoworkImageAttachment[],
    fileAttachments?: CoworkFileAttachment[],
    expertIds?: string[],
    goalMode?: boolean,
  ) => boolean | void | Promise<boolean | void>;
  onStop?: () => void;
  isStreaming?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Keeps text editing available while session-bound actions wait for the target session. */
  sessionContextPending?: boolean;
  size?: 'normal' | 'large';
  workingDirectory?: string;
  workingDirectoryName?: string;
  onWorkingDirectoryChange?: (dir: string) => void;
  onCreateProject?: (dir: string, name: string) => Promise<boolean>;
  onUseNoFolder?: (dir: string) => void | Promise<void>;
  showFolderSelector?: boolean;
  showNoFolderAction?: boolean;
  showModelSelector?: boolean;
  onManageSkills?: () => void;
  onManageConnectors?: () => void;
  /** Work mode: show the 请求权限/全部允许 selector in the toolbar */
  showPermissionModeSelector?: boolean;
  permissionMode?: CoworkPermissionMode;
  onPermissionModeChange?: (mode: CoworkPermissionMode) => void;
  sessionId?: string;
  /** When true, hides attachment/skill buttons but keeps the input box visible (disabled) */
  remoteManaged?: boolean;
  topAccessory?: ReactNode;
  resumeTaskActive?: boolean;
  onCancelTaskResume?: () => void;
}
