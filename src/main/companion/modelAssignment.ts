import { CompanionCapability, CompanionUnavailableReason } from '../../shared/companion/constants';
import type { CompanionAvailability } from '../../shared/companion/types';
import type { MagpieModelService } from '../magpie/modelService';

const COOLDOWN_MS = 60_000;
const MAX_FAILURES = 64;

export class CompanionModelAssignment {
  private readonly failures = new Map<string, number>();

  constructor(
    private readonly service: Pick<MagpieModelService, 'resolveAutomatic'>,
    private readonly now: () => number = Date.now,
  ) {}

  failed(modelId: string): void {
    this.failures.delete(modelId);
    this.failures.set(modelId, this.now() + COOLDOWN_MS);
    if (this.failures.size > MAX_FAILURES) this.failures.delete(this.failures.keys().next().value!);
  }

  async resolve(imageInput = false): Promise<CompanionAvailability> {
    const local: CompanionAvailability = {
      capability: CompanionCapability.Local,
      modelId: null,
      imageInput: false,
      toolUse: false,
    };
    try {
      for (const [id, until] of this.failures) if (until <= this.now()) this.failures.delete(id);
      const selected = await this.service.resolveAutomatic(new Set(this.failures.keys()), {
        imageInput,
      });
      if (!selected) {
        const reason = imageInput
          ? CompanionUnavailableReason.ImageUnavailable
          : this.failures.size
            ? CompanionUnavailableReason.ModelFailed
            : CompanionUnavailableReason.NoModel;
        return { ...local, reason };
      }
      return {
        capability: CompanionCapability.Chat,
        modelId: selected.modelId,
        imageInput: selected.imageInput,
        toolUse: false,
      };
    } catch {
      return { ...local, reason: CompanionUnavailableReason.ServiceUnavailable };
    }
  }
}
