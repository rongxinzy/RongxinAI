import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const USAGE = `Usage: node scripts/render-enterprise-config.mjs --output <file> [--base-url <url>] [--agent-control-base-url <url>]

Renders the resources/zhiyuan-enterprise/config.json payload injected into
enterprise packages. The AEP base URL is read from --base-url, the first
positional argument, or the ZHIYUAN_AEP_BASE_URL environment variable. Only
http/https URLs without embedded credentials, query, or fragment are accepted;
http URLs are rendered with "allowInsecureHttp": true and https with false.
Trailing slashes are stripped exactly like the runtime loader in
src/enterprise-config.ts.`;

export function renderEnterpriseConfig(rawBaseUrl, rawAgentControlBaseUrl) {
  if (typeof rawBaseUrl !== 'string' || rawBaseUrl.trim().length === 0) {
    throw new Error(
      'Zhiyuan AEP base URL is required. Pass --base-url or set ZHIYUAN_AEP_BASE_URL.',
    );
  }
  let url;
  try {
    url = new URL(rawBaseUrl.trim());
  } catch (error) {
    throw new Error(`Zhiyuan AEP base URL is invalid: ${rawBaseUrl}`, { cause: error });
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('Zhiyuan AEP base URL must not contain credentials, query, or fragment.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error(`Zhiyuan AEP base URL protocol is not supported: ${url.protocol}`);
  }
  const config = {
    schemaVersion: 1,
    aepBaseUrl: url.toString().replace(/\/+$/, ''),
    allowInsecureHttp: url.protocol === 'http:',
  };
  if (rawAgentControlBaseUrl !== undefined) {
    let agentUrl;
    try {
      agentUrl = new URL(String(rawAgentControlBaseUrl).trim());
    } catch (error) {
      throw new Error(`Zhiyuan agent control base URL is invalid: ${rawAgentControlBaseUrl}`, {
        cause: error,
      });
    }
    if (agentUrl.username || agentUrl.password || agentUrl.search || agentUrl.hash) {
      throw new Error(
        'Zhiyuan agent control base URL must not contain credentials, query, or fragment.',
      );
    }
    if (agentUrl.protocol !== 'https:' && agentUrl.protocol !== 'http:') {
      throw new Error(
        `Zhiyuan agent control base URL protocol is not supported: ${agentUrl.protocol}`,
      );
    }
    config.agentControlBaseUrl = agentUrl.toString().replace(/\/+$/, '');
  }
  return config;
}

export function parseArguments(argv, env) {
  let baseUrl;
  let agentControlBaseUrl;
  let output;
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      return { help: true };
    } else if (argument === '--base-url') {
      index += 1;
      baseUrl = readValue(argv, index, '--base-url');
    } else if (argument.startsWith('--base-url=')) {
      baseUrl = argument.slice('--base-url='.length);
    } else if (argument === '--agent-control-base-url') {
      index += 1;
      agentControlBaseUrl = readValue(argv, index, '--agent-control-base-url');
    } else if (argument.startsWith('--agent-control-base-url=')) {
      agentControlBaseUrl = argument.slice('--agent-control-base-url='.length);
    } else if (argument === '--output' || argument === '-o') {
      index += 1;
      output = readValue(argv, index, '--output');
    } else if (argument.startsWith('--output=')) {
      output = argument.slice('--output='.length);
    } else if (argument.startsWith('-')) {
      throw new Error(`Unknown argument: ${argument}`);
    } else {
      positional.push(argument);
    }
  }
  if (positional.length > 1) {
    throw new Error(`Unexpected extra arguments: ${positional.slice(1).join(' ')}`);
  }
  return {
    baseUrl: baseUrl ?? positional[0] ?? env.ZHIYUAN_AEP_BASE_URL,
    agentControlBaseUrl:
      agentControlBaseUrl ??
      (env.ZHIYUAN_AGENT_CONTROL_BASE_URL === '' ? undefined : env.ZHIYUAN_AGENT_CONTROL_BASE_URL),
    output,
  };
}

export function writeEnterpriseConfig(output, config) {
  const outputPath = path.resolve(output);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return outputPath;
}

function readValue(argv, index, flag) {
  const value = argv[index];
  if (value === undefined || value.startsWith('-')) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function main() {
  const parsed = parseArguments(process.argv.slice(2), process.env);
  if (parsed.help) {
    console.log(USAGE);
    return;
  }
  const config = renderEnterpriseConfig(parsed.baseUrl, parsed.agentControlBaseUrl);
  if (!parsed.output) {
    throw new Error('An output path is required. Pass --output <file>.');
  }
  const outputPath = writeEnterpriseConfig(parsed.output, config);
  console.log(JSON.stringify({ status: 'rendered', output: outputPath, config }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(
      `render-enterprise-config: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}
