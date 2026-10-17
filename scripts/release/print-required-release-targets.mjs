import { listRequiredReleaseTargets } from './inference-edition-targets.mjs';

for (const target of listRequiredReleaseTargets()) {
  console.log(target);
}
