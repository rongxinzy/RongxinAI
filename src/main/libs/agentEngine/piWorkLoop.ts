import { buildPiAgentLoopTool, PiAgentLoopController, PiAgentLoopMode } from './piAgentLoop';

export interface PiWorkLoopAssembly {
  controller: PiAgentLoopController;
  tool: Record<string, unknown>;
  initialPrompt: string;
}

export function createPiWorkLoop(options: {
  goal: string;
  completionWorkflow?: ConstructorParameters<typeof PiAgentLoopController>[0];
  start: boolean;
}): PiWorkLoopAssembly {
  const controller = new PiAgentLoopController(options.completionWorkflow);
  return {
    controller,
    tool: buildPiAgentLoopTool(controller),
    initialPrompt: options.start
      ? controller.start({
          mode: PiAgentLoopMode.Goal,
          goal: options.goal,
          passes: 0,
          stages: [],
        })
      : '',
  };
}
