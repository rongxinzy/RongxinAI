import path from 'path';

import { app } from 'electron';

import { rt } from './runtimeState';
import { getCoworkStore, getSkillManager, getStore } from './runtimeServices';
import { EngramManager } from '../memory/engramManager';
import { ProjectMemoryService } from '../memory/projectMemoryService';
import { MemoryRepository } from '../memory/repository';
import { ZhiYuanEngramAdapter } from '../memory/zhiyuanEngramAdapter';
import { resolveProjectIdentity } from '../memory/projectIdentity';
import { coworkImageRoot } from '../coworkImageAttachments';
import { ConversationHistoryService } from '../conversationHistory/service';
import { SessionSummaryService } from '../memory/sessionSummaryService';
import { SessionSummaryBackfillService } from '../memory/sessionSummaryBackfillService';
import {
  resolveAnySearchGatewayToken,
  resolveAnySearchGatewayUrl,
} from '../libs/anysearchGatewayCredentials';
import { PiRuntimeAdapter } from '../libs/agentEngine/piRuntimeAdapter';
import { WorkbenchTaskService } from '../workbenchTask/taskService';
import { promoteVerifiedWorkbenchRun } from '../memory/taskMemoryPromotion';

export const getWorkbenchTaskService = (): WorkbenchTaskService => {
  if (!rt.workbenchTaskService) {
    rt.workbenchTaskService = new WorkbenchTaskService(getStore().getDatabase(), {
      onVerifiedRun: event => {
        const complete = getPiRuntimeAdapter().getSessionMemoryCompletion(event.task.sessionId);
        if (!complete) {
          console.warn(
            '[Memory] Skipped verified run extraction because the session model is unavailable.',
          );
          return;
        }
        void promoteVerifiedWorkbenchRun(getProjectMemoryService(), event, complete).catch(
          error => {
            console.warn('[Memory] Failed to extract verified run memory:', error);
          },
        );
      },
    });
  }
  return rt.workbenchTaskService;
};

export const getEngramManager = (): EngramManager => {
  if (!rt.engramManager) {
    rt.engramManager = new EngramManager({
      userDataPath: app.getPath('userData'),
      resourcesPath: process.resourcesPath,
      projectRoot: app.isPackaged ? undefined : process.cwd(),
    });
  }
  return rt.engramManager;
};

export const getProjectMemoryService = (): ProjectMemoryService => {
  if (!rt.engramAdapter) rt.engramAdapter = new ZhiYuanEngramAdapter(getEngramManager());
  if (!rt.memoryRepository) rt.memoryRepository = new MemoryRepository(getStore().getDatabase());
  if (!rt.projectMemoryService) {
    rt.projectMemoryService = new ProjectMemoryService(
      rt.memoryRepository,
      rt.engramAdapter,
      resolveProjectIdentity,
      path.join(app.getPath('userData'), 'memory'),
    );
  }
  return rt.projectMemoryService;
};

export const getPiRuntimeAdapter = (): PiRuntimeAdapter => {
  if (!rt.piRuntimeAdapter) {
    // Pi shell tools inherit the main-process environment. Keep the gateway
    // credential here so installed builds work without user configuration.
    process.env.ZHIYUAN_ANYSEARCH_GATEWAY_TOKEN = resolveAnySearchGatewayToken();
    process.env.ZHIYUAN_ANYSEARCH_GATEWAY_URL = resolveAnySearchGatewayUrl();
    rt.piRuntimeAdapter = new PiRuntimeAdapter();
    rt.piRuntimeAdapter.setImageAttachmentRoot(coworkImageRoot(app.getPath('userData')));
    rt.piRuntimeAdapter.setCoworkStore(getCoworkStore());
    rt.piRuntimeAdapter.setWorkbenchTaskService(getWorkbenchTaskService());
    rt.piRuntimeAdapter.setProjectMemoryService(getProjectMemoryService());
    rt.piRuntimeAdapter.setSessionSummaryService(
      new SessionSummaryService(getProjectMemoryService(), getCoworkStore()),
    );
    rt.piRuntimeAdapter.setSessionSummaryBackfillService(
      new SessionSummaryBackfillService(getProjectMemoryService(), getCoworkStore()),
    );
    rt.piRuntimeAdapter.setConversationHistoryService(
      new ConversationHistoryService(getStore().getDatabase()),
    );
    // Live team member definitions must read the same bundled truth as the
    // main-session preset snapshot, not the userData skills copy.
    rt.piRuntimeAdapter.setBundledSkillsRoot(getSkillManager().getBundledSkillsRoot());
    // MCP initialization runs asynchronously, so late injection may still be needed.
    console.log('[PiRuntime] mcpServerManager available at init:', rt.mcpServerManager !== null);
  }
  // Late-injection: mcpServerManager is created async after Pi init.
  // On subsequent calls (e.g. from IPC handlers), it is available and
  // we inject it so Pi sessions can use MCP tools.
  if (rt.mcpServerManager && !rt.piRuntimeAdapter.hasMcpServerManager()) {
    console.log('[PiRuntime] Late-injecting mcpServerManager (was null at init)');
    rt.piRuntimeAdapter.setMcpServerManager(rt.mcpServerManager);
  }
  return rt.piRuntimeAdapter;
};
