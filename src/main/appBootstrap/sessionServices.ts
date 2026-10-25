import path from 'path';

import { app } from 'electron';

import { agentRuntime } from './agentRuntimeState';
import { memoryRuntime } from './memoryRuntimeState';
import { mcpRuntime } from './mcpRuntimeState';
import { getCoworkStore, getArtifactLedger, getSkillManager, getStore } from './runtimeServices';
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
import { CompanionMemoryService } from '../companion/memory';
import { CompanionMemoryRetractions } from '../companion/memoryRetractions';

export const getWorkbenchTaskService = (): WorkbenchTaskService => {
  if (!agentRuntime.workbenchTaskService) {
    agentRuntime.workbenchTaskService = new WorkbenchTaskService(getStore().getDatabase(), {
      listLedgerArtifacts: scopeId => getArtifactLedger().list(scopeId),
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
  return agentRuntime.workbenchTaskService;
};

export const getEngramManager = (): EngramManager => {
  if (!memoryRuntime.engramManager) {
    memoryRuntime.engramManager = new EngramManager({
      userDataPath: app.getPath('userData'),
      resourcesPath: process.resourcesPath,
      projectRoot: app.isPackaged ? undefined : process.cwd(),
    });
  }
  return memoryRuntime.engramManager;
};

export const getProjectMemoryService = (): ProjectMemoryService => {
  if (!memoryRuntime.engramAdapter)
    memoryRuntime.engramAdapter = new ZhiYuanEngramAdapter(getEngramManager());
  if (!memoryRuntime.memoryRepository)
    memoryRuntime.memoryRepository = new MemoryRepository(getStore().getDatabase());
  if (!memoryRuntime.projectMemoryService) {
    memoryRuntime.projectMemoryService = new ProjectMemoryService(
      memoryRuntime.memoryRepository,
      memoryRuntime.engramAdapter,
      resolveProjectIdentity,
      path.join(app.getPath('userData'), 'memory'),
    );
  }
  return memoryRuntime.projectMemoryService;
};

const getCompanionMemoryService = (): CompanionMemoryService => {
  const shared = getProjectMemoryService();
  if (!memoryRuntime.companionMemoryService) {
    memoryRuntime.companionMemoryService = new CompanionMemoryService(
      memoryRuntime.memoryRepository!,
      memoryRuntime.engramAdapter!,
      shared,
      path.join(app.getPath('userData'), 'companions'),
      new CompanionMemoryRetractions(getStore().getDatabase()),
    );
  }
  return memoryRuntime.companionMemoryService;
};

export const getPiRuntimeAdapter = (): PiRuntimeAdapter => {
  if (!agentRuntime.piRuntimeAdapter) {
    // Pi shell tools inherit the main-process environment. Keep the gateway
    // credential here so installed builds work without user configuration.
    process.env.ZHIYUAN_ANYSEARCH_GATEWAY_TOKEN = resolveAnySearchGatewayToken();
    process.env.ZHIYUAN_ANYSEARCH_GATEWAY_URL = resolveAnySearchGatewayUrl();
    agentRuntime.piRuntimeAdapter = new PiRuntimeAdapter();
    agentRuntime.piRuntimeAdapter.setImageAttachmentRoot(coworkImageRoot(app.getPath('userData')));
    // File-backed Pi sessions live beside the SQLite transcript under
    // userData; one directory per Cowork session id.
    agentRuntime.piRuntimeAdapter.setPiSessionStoreRoot(app.getPath('userData'));
    agentRuntime.piRuntimeAdapter.setCompanionStore(getStore());
    agentRuntime.piRuntimeAdapter.setCoworkStore(getCoworkStore());
    agentRuntime.piRuntimeAdapter.setWorkbenchTaskService(getWorkbenchTaskService());
    agentRuntime.piRuntimeAdapter.setArtifactLedger(getArtifactLedger());
    agentRuntime.piRuntimeAdapter.setProjectMemoryService(getProjectMemoryService());
    agentRuntime.piRuntimeAdapter.setCompanionMemoryService(getCompanionMemoryService());
    agentRuntime.piRuntimeAdapter.setSessionSummaryService(
      new SessionSummaryService(getProjectMemoryService(), getCoworkStore()),
    );
    agentRuntime.piRuntimeAdapter.setSessionSummaryBackfillService(
      new SessionSummaryBackfillService(getProjectMemoryService(), getCoworkStore()),
    );
    agentRuntime.piRuntimeAdapter.setConversationHistoryService(
      new ConversationHistoryService(getStore().getDatabase()),
    );
    // Live team member definitions must read the same bundled truth as the
    // main-session preset snapshot, not the userData skills copy.
    agentRuntime.piRuntimeAdapter.setBundledSkillsRoot(getSkillManager().getBundledSkillsRoot());
    // MCP initialization runs asynchronously, so late injection may still be needed.
    console.log(
      '[PiRuntime] mcpServerManager available at init:',
      mcpRuntime.serverManager !== null,
    );
  }
  // Late-injection: mcpServerManager is created async after Pi init.
  // On subsequent calls (e.g. from IPC handlers), it is available and
  // we inject it so Pi sessions can use MCP tools.
  if (mcpRuntime.serverManager && !agentRuntime.piRuntimeAdapter.hasMcpServerManager()) {
    console.log('[PiRuntime] Late-injecting mcpServerManager (was null at init)');
    agentRuntime.piRuntimeAdapter.setMcpServerManager(mcpRuntime.serverManager);
  }
  return agentRuntime.piRuntimeAdapter;
};
