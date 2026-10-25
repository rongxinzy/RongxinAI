import { $ } from 'bun';
import { fileURLToPath } from 'node:url';
import { packageCommands } from './package-commands.mjs';

const [name, ...args] = process.argv.slice(2);
if (!Object.hasOwn(packageCommands, name)) throw new Error(`Unknown packaging command: ${name}`);
// Only repository-owned command text is raw; forwarded CLI arguments remain shell-escaped.
await $`${{ raw: packageCommands[name] }} ${args}`.cwd(
  fileURLToPath(new URL('../..', import.meta.url)),
);
