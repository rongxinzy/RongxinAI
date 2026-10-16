import { app } from 'electron';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

export type CoworkApiType = 'anthropic' | 'openai';

export type CoworkApiConfig = {
  apiKey: string;
  baseURL: string;
  model: string;
  apiType?: CoworkApiType;
};

const CONFIG_FILE_NAME = 'api-config.json';

function getConfigPath(): string {
  const userDataPath = app.getPath('userData');
  return join(userDataPath, CONFIG_FILE_NAME);
}

export function saveCoworkApiConfig(config: CoworkApiConfig): void {
  const configPath = getConfigPath();
  const userDataPath = app.getPath('userData');

  if (!existsSync(userDataPath)) {
    mkdirSync(userDataPath, { recursive: true });
  }

  if (!config.apiKey || !config.baseURL || !config.model) {
    throw new Error('Invalid config: apiKey, baseURL, and model are required');
  }

  const normalized: CoworkApiConfig = {
    apiKey: config.apiKey.trim(),
    baseURL: config.baseURL.trim(),
    model: config.model.trim(),
    apiType: config.apiType === 'openai' ? 'openai' : 'anthropic',
  };

  writeFileSync(configPath, JSON.stringify(normalized, null, 2), 'utf8');
  console.info('[cowork-config] API config saved successfully');
}
