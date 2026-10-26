import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { parseConfig, type ZhiyuanEnterpriseConfig } from '../enterprise-config.js';

const MAX_CONNECTION_CONFIG_BYTES = 64 * 1024;

export class EnterpriseConnectionConfigStore {
  readonly #file: string;

  constructor(userData: string) {
    this.#file = path.join(userData, 'zhiyuan-enterprise', 'connection.json');
  }

  async load(): Promise<ZhiyuanEnterpriseConfig | null> {
    try {
      const file = await fs.open(this.#file, 'r');
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size === 0 || stat.size > MAX_CONNECTION_CONFIG_BYTES) {
          throw new Error('Zhiyuan enterprise connection configuration size is invalid.');
        }
        return parseConfig(JSON.parse(await file.readFile('utf8')) as unknown);
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async save(baseUrl: string, agentControlBaseUrl?: string): Promise<void> {
    const config = parseConfig({
      schemaVersion: 1,
      aepBaseUrl: baseUrl,
      allowInsecureHttp: true,
      ...(agentControlBaseUrl ? { agentControlBaseUrl } : {}),
    });
    const temporary = `${this.#file}.${randomUUID()}.tmp`;
    await fs.mkdir(path.dirname(this.#file), { recursive: true, mode: 0o700 });
    try {
      await fs.writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
        flag: 'wx',
        mode: 0o600,
      });
      await fs.rename(temporary, this.#file);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  }
}
