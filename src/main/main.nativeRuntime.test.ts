import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const readSource = (relativePath: string): string =>
  readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8');
const directory = fileURLToPath(new URL('./appBootstrap', import.meta.url));
const bootstrap = readdirSync(directory)
  .filter(file => file.endsWith('.ts') && !file.endsWith('.test.ts'))
  .map(file => readFileSync(`${directory}/${file}`, 'utf8'))
  .join('\n');
const main = readSource('./main.ts');

test('composition root exposes local automation without a messaging runtime', () => {
  expect(main).toContain('registerScheduledTaskIpc({');
  expect(main).toContain('getScheduledTaskService,');
  expect(bootstrap).toContain('new DurableAutomationService(');
  expect(`${main}\n${bootstrap}`).not.toMatch(
    /register(?:ImGateway|ImInstance|Integrations)Ipc|getIMGatewayManager|ccConnectRuntime|channelRuntimeState/,
  );
});

test('startup does not construct another scheduler or migrate retired task stores', () => {
  expect(bootstrap).not.toMatch(
    /new (?:LocalCronClock|LocalSchedulerRuntime|SqliteScheduledTaskStore)|migrateLegacyScheduledTask/,
  );
  expect(readSource('./appBootstrap/initApp.ts')).toContain('await markNativeResourcesReady();');
  expect(readSource('./appBootstrap/nativeRecovery.ts')).toContain('await startAutomations();');
});
