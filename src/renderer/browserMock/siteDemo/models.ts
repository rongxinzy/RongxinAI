/** Local-inference catalog and installed models for the official-site demo. */
import type { LlamaCppModel } from '../../../shared/llamacpp/types';
import type {
  MarketplaceCapability,
  MarketplaceFit,
  MarketplaceModel,
} from '../../../shared/marketplace/types';
import { pick, SITE_NOW, type SiteDemoLang } from './content';

const GiB = 1024 ** 3;

type Entry = {
  repoId: string;
  name: string;
  capability: MarketplaceCapability;
  params: number;
  sizeGiB: number;
  downloads: number;
  zh: string;
  en: string;
  tags: string[];
  fit: MarketplaceFit['status'];
  stars: number;
};

const ENTRIES: Entry[] = [
  {
    repoId: 'Qwen/Qwen3-8B-GGUF',
    name: 'Qwen3 8B',
    capability: 'chat',
    params: 8,
    sizeGiB: 5.0,
    downloads: 182400,
    zh: '通用对话与写作，中英双语表现均衡。',
    en: 'General chat and writing, strong in Chinese and English.',
    tags: ['chat', 'reasoning'],
    fit: 'excellent',
    stars: 5,
  },
  {
    repoId: 'Qwen/Qwen3-14B-GGUF',
    name: 'Qwen3 14B',
    capability: 'reasoning',
    params: 14,
    sizeGiB: 9.0,
    downloads: 96300,
    zh: '更强的推理与长文写作能力。',
    en: 'Stronger reasoning and long-form writing.',
    tags: ['reasoning', 'chat'],
    fit: 'good',
    stars: 5,
  },
  {
    repoId: 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF',
    name: 'Qwen2.5 Coder 7B',
    capability: 'code',
    params: 7,
    sizeGiB: 4.7,
    downloads: 143800,
    zh: '代码补全、解释与重构。',
    en: 'Code completion, explanation and refactoring.',
    tags: ['code'],
    fit: 'excellent',
    stars: 5,
  },
  {
    repoId: 'deepseek-ai/DeepSeek-R1-Distill-Qwen-7B-GGUF',
    name: 'DeepSeek R1 Distill 7B',
    capability: 'reasoning',
    params: 7,
    sizeGiB: 4.7,
    downloads: 210500,
    zh: '蒸馏推理模型，适合数学与逻辑问题。',
    en: 'Distilled reasoning model for math and logic.',
    tags: ['reasoning'],
    fit: 'excellent',
    stars: 4,
  },
  {
    repoId: 'google/gemma-3-12b-it-GGUF',
    name: 'Gemma 3 12B',
    capability: 'vision',
    params: 12,
    sizeGiB: 7.3,
    downloads: 88700,
    zh: '支持图像输入的多模态模型。',
    en: 'Multimodal model with image input.',
    tags: ['vision', 'chat'],
    fit: 'good',
    stars: 4,
  },
  {
    repoId: 'THUDM/GLM-4-9B-0414-GGUF',
    name: 'GLM-4 9B',
    capability: 'chat',
    params: 9,
    sizeGiB: 5.7,
    downloads: 72400,
    zh: '中文对话与写作。',
    en: 'Chinese chat and writing.',
    tags: ['chat'],
    fit: 'excellent',
    stars: 4,
  },
  {
    repoId: 'Qwen/Qwen2.5-VL-7B-Instruct-GGUF',
    name: 'Qwen2.5 VL 7B',
    capability: 'vision',
    params: 7,
    sizeGiB: 4.7,
    downloads: 69300,
    zh: '图表、截图与文档理解。',
    en: 'Understands charts, screenshots and documents.',
    tags: ['vision'],
    fit: 'excellent',
    stars: 4,
  },
  {
    repoId: 'microsoft/Phi-4-mini-instruct-GGUF',
    name: 'Phi-4 mini',
    capability: 'chat',
    params: 3.8,
    sizeGiB: 2.5,
    downloads: 64200,
    zh: '小参数量下的指令遵循与推理。',
    en: 'Instruction following and reasoning at a small size.',
    tags: ['chat', 'reasoning'],
    fit: 'excellent',
    stars: 4,
  },
  {
    repoId: 'Qwen/Qwen3-Embedding-0.6B-GGUF',
    name: 'Qwen3 Embedding 0.6B',
    capability: 'embedding',
    params: 0.6,
    sizeGiB: 0.6,
    downloads: 58100,
    zh: '文本向量化，用于本地知识检索。',
    en: 'Text embeddings for local retrieval.',
    tags: ['embedding'],
    fit: 'excellent',
    stars: 4,
  },
  {
    repoId: 'mistralai/Mistral-Small-3.1-24B-Instruct-GGUF',
    name: 'Mistral Small 3.1 24B',
    capability: 'chat',
    params: 24,
    sizeGiB: 14.3,
    downloads: 41800,
    zh: '长上下文与工具调用。',
    en: 'Long context and tool calling.',
    tags: ['chat'],
    fit: 'limited',
    stars: 4,
  },
];

const INSTALLED = new Set(['Qwen/Qwen3-8B-GGUF', 'Qwen/Qwen2.5-Coder-7B-Instruct-GGUF']);

function fileName(entry: Entry): string {
  return `${entry.name.toLowerCase().replace(/[^a-z0-9.]+/g, '-')}-q4_k_m.gguf`;
}

export function siteMarketplace(lang: SiteDemoLang): MarketplaceModel[] {
  return ENTRIES.map(entry => {
    const file = fileName(entry);
    return {
      source: 'modelscope-gguf',
      id: entry.repoId,
      repoId: entry.repoId,
      name: entry.name,
      description: pick(lang, entry.zh, entry.en),
      tags: entry.tags,
      sizes: [entry.params <= 4 ? 'small' : entry.params <= 14 ? 'desktop' : 'workstation'],
      recommendedTag: 'Q4_K_M',
      capability: entry.capability,
      capabilities: [entry.capability],
      filePath: file,
      downloads: entry.downloads,
      parameterCount: entry.params * 1e9,
      installed: INSTALLED.has(entry.repoId),
      publisherVerified: true,
      metadataStatus: 'verified',
      licenseStatus: 'permissive',
      files: [
        {
          path: file,
          sizeBytes: Math.round(entry.sizeGiB * GiB),
          quantization: 'Q4_K_M',
          isRecommended: true,
        },
      ],
      fit: {
        status: entry.fit,
        estimatedVramMiB: Math.round(entry.sizeGiB * 1024 * 1.15),
        recommendedContext: 16384,
      },
      score: {
        stars: entry.stars,
        value: entry.stars * 20,
        confidence: 'A',
        taskQuality: 0.9,
        deviceFit: 0.9,
        runtimeCompatibility: 1,
        trust: 0.95,
        community: 0.9,
        reasons: [],
        scoreVersion: 'site-demo',
      },
      runtime: {
        format: 'gguf',
        status: 'verified',
        ggufFilesVerified: true,
        sha256Verified: true,
        source: 'modelscope-file-api',
        observedAt: new Date(SITE_NOW).toISOString(),
        reasons: [],
      },
    };
  });
}

export function siteLocalModels(): LlamaCppModel[] {
  return ENTRIES.filter(entry => INSTALLED.has(entry.repoId)).map(entry => ({
    name: entry.name,
    id: entry.repoId,
    model: entry.repoId,
    path: `/Users/lin/.zhiyuan/models/${fileName(entry)}`,
    modified_at: new Date(SITE_NOW - 48 * 3_600_000).toISOString(),
    size: Math.round(entry.sizeGiB * GiB),
    source: 'modelscope',
    status: entry.repoId === 'Qwen/Qwen3-8B-GGUF' ? 'loaded' : 'unloaded',
    details: {
      format: 'gguf',
      parameter_size: `${entry.params}B`,
      quantization_level: 'Q4_K_M',
      context_length: 32768,
    },
  }));
}
