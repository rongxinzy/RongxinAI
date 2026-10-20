import { describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MagpieUsagePeriod } from '../../shared/magpie/routingUsage';
import { MagpieManager } from './manager';
import { verifyMagpieBinary } from './integrity';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

describe('magpie routing and usage API contract', () => {
  it.skipIf(process.env.ZHIYUAN_MAGPIE_SMOKE !== '1')(
    'reads groups, usage and quotas from the pinned binary',
    async () => {
      const root = await fs.mkdtemp(path.join(os.tmpdir(), 'zhiyuan-magpie-routing-'));
      const manager = new MagpieManager({
        resourcesRoot: path.resolve(process.env.ZHIYUAN_MAGPIE_RESOURCES || 'resources/magpie'),
        privateHome: path.join(root, 'service'),
        environment: {
          HOME: root,
          USERPROFILE: root,
          APPDATA: path.join(root, 'appdata'),
          LOCALAPPDATA: path.join(root, 'local'),
          PATH: process.env.PATH,
          TEMP: root,
          TMP: root,
        },
        verify: (dir, signal) =>
          verifyMagpieBinary(dir, signal, async file => {
            const hash = createHash('sha256');
            for await (const chunk of createReadStream(file)) hash.update(chunk);
            return hash.digest('hex');
          }),
      });
      try {
        expect((await manager.start()).state).toBe('running');
        const groups = await manager.routingGroups();
        expect(Array.isArray(groups.groups)).toBe(true);
        expect(Array.isArray(groups.models)).toBe(true);
        const summary = await manager.usageSummary(MagpieUsagePeriod.Week);
        expect(typeof summary.calls).toBe('number');
        const page = await manager.usageRequests(MagpieUsagePeriod.Week, 0, 5);
        expect(Array.isArray(page.rows)).toBe(true);
        const quotas = await manager.usageQuotas(false);
        expect(Array.isArray(quotas)).toBe(true);
        const budget = await manager.usageBudget();
        expect(typeof budget.usageAlertPercent).toBe('number');
      } finally {
        await manager.stop();
        await fs.rm(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
