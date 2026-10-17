/**
 * Direct scheduled-task turns: bypass agent execution and persist a
 * synthesized cron.add tool turn in the cowork store.
 */

import type { CoworkStore } from '../../coworkStore';
import type {
  IMScheduledTaskCreationResult,
  ParsedIMScheduledTaskRequest,
} from '../imScheduledTaskHandler';
import type { IMMessage } from '../types';

interface IMCoworkScheduledTaskDeps {
  coworkStore: CoworkStore;
  createScheduledTask: (params: {
    sessionId: string;
    message: IMMessage;
    request: ParsedIMScheduledTaskRequest;
  }) => Promise<IMScheduledTaskCreationResult>;
}

export async function runIMDirectScheduledTaskTurn(
  deps: IMCoworkScheduledTaskDeps,
  sessionId: string,
  message: IMMessage,
  formattedContent: string,
  request: ParsedIMScheduledTaskRequest,
): Promise<string> {
  const toolUseId = `cron:${Date.now()}`;

  deps.coworkStore.addMessage(sessionId, {
    type: 'user',
    content: formattedContent,
    metadata: {},
  });
  deps.coworkStore.addMessage(sessionId, {
    type: 'tool_use',
    content: 'Using tool: cron',
    metadata: {
      toolName: 'cron',
      toolUseId,
      toolInput: {
        action: 'add',
        job: {
          name: request.taskName,
          schedule: {
            kind: 'at',
            at: request.scheduleAt,
          },
          payload: {
            kind: 'systemEvent',
            text: request.payloadText,
          },
          sessionTarget: 'main',
          enabled: true,
        },
      },
    },
  });

  try {
    const created = await deps.createScheduledTask({
      sessionId,
      message,
      request,
    });
    const toolResultText = JSON.stringify(created);
    deps.coworkStore.addMessage(sessionId, {
      type: 'tool_result',
      content: toolResultText,
      metadata: {
        toolUseId,
        toolResult: toolResultText,
        isError: false,
      },
    });
    deps.coworkStore.addMessage(sessionId, {
      type: 'assistant',
      content: request.confirmationText,
      metadata: {},
    });
    console.log(
      '[IMCoworkHandler] Created IM scheduled task via cron.add',
      JSON.stringify({
        sessionId,
        platform: message.platform,
        conversationId: message.conversationId,
        taskId: created.id,
        taskName: created.name,
        scheduleAt: created.scheduleAt,
      }),
    );
    return request.confirmationText;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    deps.coworkStore.addMessage(sessionId, {
      type: 'tool_result',
      content: errorMessage,
      metadata: {
        toolUseId,
        toolResult: errorMessage,
        error: errorMessage,
        isError: true,
      },
    });
    const reply = `定时任务创建失败：${errorMessage}`;
    deps.coworkStore.addMessage(sessionId, {
      type: 'assistant',
      content: reply,
      metadata: {},
    });
    console.warn(
      '[IMCoworkHandler] Failed to create IM scheduled task via cron.add',
      JSON.stringify({
        sessionId,
        platform: message.platform,
        conversationId: message.conversationId,
        error: errorMessage,
      }),
    );
    return reply;
  }
}
