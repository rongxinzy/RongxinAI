export interface StrataOpenAiModel {
  id: string;
  name?: string;
}

export class StrataClient {
  constructor(private readonly baseUrl: string) {}

  async health(timeoutMs = 800): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(new URL('/health', this.baseUrl), {
        signal: controller.signal,
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async listModels(timeoutMs = 1500): Promise<StrataOpenAiModel[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(new URL('/v1/models', this.baseUrl), {
        signal: controller.signal,
      });
      if (!response.ok) return [];
      const payload = (await response.json()) as { data?: Array<{ id?: string }> };
      return (payload.data ?? [])
        .map(item => ({ id: String(item.id ?? '').trim() }))
        .filter(item => item.id);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}
