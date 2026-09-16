// 2026/09/16 lixiang  把待授权请求匹配到对话流里正在执行的工具卡片
import type { CoworkMessage, CoworkPermissionRequest } from '../../../types/cowork';
import type { AssistantTurnItem, ToolGroupItem } from './messageGrouping';

const readToolName = (toolUse: CoworkMessage): string => {
  const toolName = toolUse.metadata?.toolName;
  return typeof toolName === 'string' ? toolName.trim() : '';
};

const sameToolName = (left: string, right: string): boolean =>
  Boolean(left) && Boolean(right) && left.toLowerCase() === right.toLowerCase();

const readId = (value: string | null | undefined): string => value?.trim() ?? '';

const readCommand = (input: Record<string, unknown> | undefined): string =>
  typeof input?.command === 'string' ? input.command.trim() : '';

const matchesPermission = (permission: CoworkPermissionRequest, group: ToolGroupItem): boolean => {
  if (group.toolResult) return false;

  const toolName = readToolName(group.toolUse);
  if (toolName && !sameToolName(toolName, permission.toolName)) return false;

  const permissionId = readId(permission.toolUseId);
  const messageId = readId(
    typeof group.toolUse.metadata?.toolUseId === 'string' ? group.toolUse.metadata.toolUseId : '',
  );
  if (permissionId && messageId) return permissionId === messageId;

  const permissionCommand = readCommand(permission.toolInput);
  const messageCommand = readCommand(group.toolUse.metadata?.toolInput);
  return Boolean(permissionCommand && messageCommand && permissionCommand === messageCommand);
};

// 2026/09/16 lixiang  优先按 toolUseId / 命令匹配，仅当同名运行中工具只有一个时才回退
export const findToolGroupForPermission = (
  items: AssistantTurnItem[],
  permission: CoworkPermissionRequest,
): ToolGroupItem | null => {
  let sameNameOnly: ToolGroupItem | null = null;
  let sameNameCount = 0;

  for (const item of items) {
    if (item.type !== 'tool_group') continue;
    const { group } = item;
    if (matchesPermission(permission, group)) return group;
    if (group.toolResult) continue;
    if (!sameToolName(readToolName(group.toolUse), permission.toolName)) continue;
    sameNameCount += 1;
    sameNameOnly = group;
  }

  // 2026/09/16 lixiang  同名工具无法唯一确定时返回空，由独立授权卡片兜底
  return sameNameCount === 1 ? sameNameOnly : null;
};
