import { getMagpieModelService, hasMagpieModelService } from '../magpie/modelService';

type ApplyMagpieModel = (modelId: string) => Promise<void>;

let applyMagpieModel: ApplyMagpieModel | undefined;

/** Main registers the owned gateway's agent-model writer. Tests leave this unset. */
export function registerAcpMagpieModelApply(apply: ApplyMagpieModel): () => void {
  applyMagpieModel = apply;
  return () => {
    if (applyMagpieModel === apply) applyMagpieModel = undefined;
  };
}

/**
 * ACP agents read the model the gateway wrote into their CLI config.
 * Starting a lane ensures that gateway is up and, when the selected model is
 * one of the agent's options, applies it before the process launches.
 */
export async function ensureAcpModelFromMagpie(): Promise<void> {
  if (!hasMagpieModelService()) return;
  const { model } = await getMagpieModelService().resolve();
  await applyMagpieModel?.(model.id);
}
