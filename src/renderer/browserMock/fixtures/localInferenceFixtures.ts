export const mockLlamaCppStatus = {
  serviceStatus: 'stopped' as const,
  runtimeInstalled: false,
  backendInstalled: null,
  selectedBackend: null,
  availableBackends: ['cpu', 'metal', 'cuda'],
  modelsDir: '/home/user/.zhiyuan/models',
  gatewayLanToken: 'mock-token-abc123',
  capabilities: {
    gpu: false,
    metal: false,
    cuda: false,
    vulkan: false,
  },
};

export const mockLlamaCppModels = [
  {
    name: 'llama-3.3-70b-q4_k_m.gguf',
    path: '/home/user/.zhiyuan/models/llama-3.3-70b-q4_k_m.gguf',
    size: 43949015040,
    quantization: 'Q4_K_M',
    parametersB: 70,
    contextLength: 131072,
    createdAt: Date.now() - 604800000,
  },
  {
    name: 'qwen2.5-coder-32b-q5_k_m.gguf',
    path: '/home/user/.zhiyuan/models/qwen2.5-coder-32b-q5_k_m.gguf',
    size: 22939082752,
    quantization: 'Q5_K_M',
    parametersB: 32,
    contextLength: 32768,
    createdAt: Date.now() - 259200000,
  },
];

export const mockRunningModels = [
  {
    name: 'llama-3.3-70b-q4_k_m.gguf',
    contextLength: 8192,
    gpuLayers: 0,
    threads: 8,
    status: 'running',
  },
];

export const mockOllamaStatus = {
  serviceStatus: 'stopped' as const,
  installed: false,
  version: null,
  modelsDir: '/home/user/.ollama/models',
};

export const mockModelPreferences = {
  'llama-3.3-70b-q4_k_m.gguf': {
    contextLength: 8192,
    gpuLayers: 0,
    threads: 8,
    temperature: 0.7,
  },
};
