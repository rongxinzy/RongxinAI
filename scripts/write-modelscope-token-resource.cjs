'use strict';

const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const outputPath = path.join(projectRoot, 'resources', 'modelscope.tokens.local.json');

function parseDotEnv(content) {
  const values = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    values[match[1]] = unwrapDotEnvValue(match[2].trim());
  }
  return values;
}

function unwrapDotEnvValue(value) {
  const quote = value[0];
  if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
    return value.slice(1, -1);
  }
  return value.replace(/\s+#.*$/, '').trim();
}

function readLocalDotEnv() {
  const envPath = path.join(projectRoot, '.env');
  if (!fs.existsSync(envPath)) return {};
  try {
    return parseDotEnv(fs.readFileSync(envPath, 'utf-8'));
  } catch {
    return {};
  }
}

function splitTokens(value) {
  return String(value || '')
    .split(/[,\n]/)
    .map(token => token.trim())
    .filter(Boolean);
}

function main() {
  const localEnv = readLocalDotEnv();
  const tokens = [
    ...new Set([
      ...splitTokens(process.env.MODELSCOPE_TOKENS),
      ...splitTokens(process.env.MODELSCOPE_TOKEN),
      ...splitTokens(localEnv.MODELSCOPE_TOKENS),
      ...splitTokens(localEnv.MODELSCOPE_TOKEN),
    ]),
  ];

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify({ tokens }, null, 2) + '\n', 'utf-8');
  console.log(
    `[ModelScope] wrote ${tokens.length} token(s) to resources/modelscope.tokens.local.json`,
  );
}

main();
