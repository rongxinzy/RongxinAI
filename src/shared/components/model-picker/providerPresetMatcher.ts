import { LOCAL_GPU_MAGPIE_PROVIDER_ID } from '@shared/magpie/constants';
import { AISphere } from '@shared/aisphere';

export type PresetBrandKey =
  | 'deepseek'
  | 'qwen'
  | 'zhipu'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'moonshot'
  | 'minimax'
  | 'volcengine'
  | 'qianfan'
  | 'stepfun'
  | 'xiaomi'
  | 'grok'
  | 'openrouter';

export type ProviderAvatarKind =
  | PresetBrandKey
  | 'llamacpp'
  | 'organization'
  | 'subscription'
  | 'group'
  | 'custom';

const KEY_ALIASES: Record<string, PresetBrandKey> = {
  deepseek: 'deepseek',
  qwen: 'qwen',
  'qwen-portal': 'qwen',
  dashscope: 'qwen',
  zhipu: 'zhipu',
  zai: 'zhipu',
  bigmodel: 'zhipu',
  openai: 'openai',
  'openai-codex': 'openai',
  anthropic: 'anthropic',
  claude: 'anthropic',
  gemini: 'gemini',
  google: 'gemini',
  'google-gemini': 'gemini',
  moonshot: 'moonshot',
  kimi: 'moonshot',
  minimax: 'minimax',
  volcengine: 'volcengine',
  doubao: 'volcengine',
  ark: 'volcengine',
  qianfan: 'qianfan',
  baidu: 'qianfan',
  ernie: 'qianfan',
  stepfun: 'stepfun',
  step: 'stepfun',
  xiaomi: 'xiaomi',
  mimo: 'xiaomi',
  grok: 'grok',
  xai: 'grok',
  openrouter: 'openrouter',
};

const HOST_MATCHERS: ReadonlyArray<{
  kind: PresetBrandKey;
  match: (host: string) => boolean;
}> = [
  { kind: 'deepseek', match: host => host === 'deepseek.com' || host.endsWith('.deepseek.com') },
  {
    kind: 'qwen',
    match: host => host === 'dashscope.aliyuncs.com' || host.endsWith('.dashscope.aliyuncs.com'),
  },
  {
    kind: 'zhipu',
    match: host =>
      host === 'bigmodel.cn' ||
      host.endsWith('.bigmodel.cn') ||
      host === 'z.ai' ||
      host.endsWith('.z.ai'),
  },
  { kind: 'openai', match: host => host === 'openai.com' || host.endsWith('.openai.com') },
  { kind: 'anthropic', match: host => host === 'anthropic.com' || host.endsWith('.anthropic.com') },
  { kind: 'gemini', match: host => host === 'generativelanguage.googleapis.com' },
  {
    kind: 'moonshot',
    match: host =>
      host === 'moonshot.cn' ||
      host.endsWith('.moonshot.cn') ||
      host === 'moonshot.ai' ||
      host.endsWith('.moonshot.ai') ||
      host === 'kimi.com' ||
      host.endsWith('.kimi.com'),
  },
  {
    kind: 'minimax',
    match: host =>
      host === 'minimaxi.com' ||
      host.endsWith('.minimaxi.com') ||
      host === 'minimax.io' ||
      host.endsWith('.minimax.io'),
  },
  {
    kind: 'volcengine',
    match: host => host === 'volces.com' || host.endsWith('.volces.com'),
  },
  {
    kind: 'qianfan',
    match: host => host === 'qianfan.baidubce.com' || host === 'aip.baidubce.com',
  },
  { kind: 'stepfun', match: host => host === 'stepfun.com' || host.endsWith('.stepfun.com') },
  {
    kind: 'xiaomi',
    match: host => host === 'xiaomimimo.com' || host.endsWith('.xiaomimimo.com'),
  },
  { kind: 'grok', match: host => host === 'x.ai' || host.endsWith('.x.ai') },
  {
    kind: 'openrouter',
    match: host => host === 'openrouter.ai' || host.endsWith('.openrouter.ai'),
  },
];

const LABEL_MATCHERS: ReadonlyArray<{ kind: PresetBrandKey; pattern: RegExp }> = [
  { kind: 'deepseek', pattern: /deepseek/i },
  { kind: 'qwen', pattern: /\bqwen\b|dashscope|阿里云百炼|通义千问|千问/i },
  { kind: 'zhipu', pattern: /\bzhipu\b|\bglm\b|bigmodel|智谱/i },
  { kind: 'openai', pattern: /\bopenai\b/i },
  { kind: 'anthropic', pattern: /\banthropic\b|\bclaude\b/i },
  { kind: 'gemini', pattern: /\bgemini\b/i },
  { kind: 'moonshot', pattern: /\bmoonshot\b|\bkimi\b|月之暗面/i },
  { kind: 'minimax', pattern: /\bminimax\b/i },
  { kind: 'volcengine', pattern: /\bvolcengine\b|\bdoubao\b|火山方舟|火山引擎|豆包/i },
  { kind: 'qianfan', pattern: /\bqianfan\b|\bernie\b|百度千帆|千帆|文心/i },
  { kind: 'stepfun', pattern: /\bstepfun\b|阶跃星辰/i },
  { kind: 'xiaomi', pattern: /\bxiaomi\b|\bmimo\b|小米/i },
  { kind: 'grok', pattern: /\bgrok\b|\bxai\b/i },
  { kind: 'openrouter', pattern: /openrouter/i },
];

function matchHostFromBaseUrl(baseUrl?: string): PresetBrandKey | null {
  const raw = baseUrl?.trim();
  if (!raw) return null;
  try {
    const normalized = /^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`;
    const parsed = new URL(normalized);
    const host = parsed.hostname.toLowerCase();
    for (const entry of HOST_MATCHERS) {
      if (entry.match(host)) return entry.kind;
    }
  } catch {
    return null;
  }
  return null;
}

export function resolveProviderAvatarKind(input: {
  providerKey?: string;
  name?: string;
  baseUrl?: string;
}): ProviderAvatarKind | null {
  const key = (input.providerKey || '').trim().toLowerCase();

  if (key === 'group') return 'group';
  if (key === 'llamacpp' || key === LOCAL_GPU_MAGPIE_PROVIDER_ID || key === 'zhiyuan-host-gpu') {
    return 'llamacpp';
  }
  if (
    key === 'custom_aisphere' ||
    key.startsWith(AISphere.HostProviderPrefix) ||
    key === 'aisphere' ||
    key === 'organization' ||
    key === 'enterprise' ||
    key === 'custom_enterprise' ||
    key.startsWith('zhiyuan-host-enterprise')
  ) {
    return 'organization';
  }
  if (key.startsWith('sub_') || key === 'subscription') {
    return 'subscription';
  }

  if (key && KEY_ALIASES[key]) {
    return KEY_ALIASES[key];
  }

  const fromUrl = matchHostFromBaseUrl(input.baseUrl);
  if (fromUrl) return fromUrl;

  const label = (input.name || '').trim();
  for (const entry of LABEL_MATCHERS) {
    if (entry.pattern.test(label) || (key && entry.pattern.test(key))) {
      return entry.kind;
    }
  }

  if (key === 'custom') return 'custom';
  return null;
}
