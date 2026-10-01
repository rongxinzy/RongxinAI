/**
 * User-facing text the workbench task gate produces.
 *
 * The output-contract denial is written for the model — it names the tool and
 * carries a copyable JSON example — and it also reaches the conversation UI, so
 * the renderer needs a translation for it. The prefix is matched instead of the
 * whole sentence because the message embeds a variable example payload.
 */
export const WorkbenchErrorMessagePrefix = {
  OutputContractRequired: 'Before executing tools, call set_task_output',
  OutputContractUncommitted: 'The output contract is not committed',
} as const;
export type WorkbenchErrorMessagePrefix =
  (typeof WorkbenchErrorMessagePrefix)[keyof typeof WorkbenchErrorMessagePrefix];

export const WorkbenchErrorI18nKey: Record<WorkbenchErrorMessagePrefix, string> = {
  [WorkbenchErrorMessagePrefix.OutputContractRequired]: 'workbenchErrorOutputContractRequired',
  [WorkbenchErrorMessagePrefix.OutputContractUncommitted]:
    'workbenchErrorOutputContractUncommitted',
};

export interface WorkbenchErrorTranslation {
  key: string;
}

/** Resolve a raw workbench message to its translation, or null when it is not ours. */
export function resolveWorkbenchErrorTranslation(
  message: string,
): WorkbenchErrorTranslation | null {
  const trimmed = message.trim();
  for (const [prefix, key] of Object.entries(WorkbenchErrorI18nKey)) {
    if (trimmed.startsWith(prefix)) return { key };
  }
  return null;
}
