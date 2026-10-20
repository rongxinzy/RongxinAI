import { parentPort } from 'node:worker_threads';

import { scanSkillSecurity } from './skillSecurityScanner';
import type { SkillSecurityReport } from './skillSecurityTypes';

type ScanRequest = { skillDirs: string[] };
type ScanResponse = { reports?: SkillSecurityReport[]; error?: string; runMs: number };

parentPort?.on('message', async (request: ScanRequest) => {
  const started = performance.now();
  const response: ScanResponse = { runMs: 0 };
  try {
    const reports: SkillSecurityReport[] = [];
    for (const skillDir of request.skillDirs) {
      reports.push(await scanSkillSecurity(skillDir));
    }
    response.reports = reports;
  } catch (error) {
    response.error =
      error instanceof Error ? error.message : 'Skill security scan failed in worker';
  }
  response.runMs = performance.now() - started;
  parentPort?.postMessage(response);
});
