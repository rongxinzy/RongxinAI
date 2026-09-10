import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

const source = readFileSync(
  fileURLToPath(new URL('./CodingWorkspaceSidebar.tsx', import.meta.url)),
  'utf8',
);

test('uses the animated folder-plus icon for the add workspace action', () => {
  expect(source).toContain(
    "import {\n  AnimatedFolderPlusIcon,\n  type AnimatedFolderPlusIconHandle,\n} from '../icons/AnimatedFolderPlusIcon';",
  );
  expect(source).toContain(
    'const addWorkspaceIconRef = useRef<AnimatedFolderPlusIconHandle>(null);',
  );
  expect(source).toContain('<AnimatedFolderPlusIcon ref={addWorkspaceIconRef} />');
});

test('animates the add workspace icon on hover but respects reduced motion', () => {
  expect(source).toContain(
    'if (!prefersReducedMotion) addWorkspaceIconRef.current?.startAnimation();',
  );
  expect(source).toContain('onMouseLeave={() => addWorkspaceIconRef.current?.stopAnimation()}');
});

test('does not fall back to the static lucide plus icon', () => {
  expect(source).not.toContain('Plus,');
  expect(source).not.toContain('<Plus />');
});

test('keeps the agent manager entry out of the workspace sidebar header', () => {
  expect(source).not.toContain('<Settings2 />');
  expect(source).not.toContain('onManageAgents');
});
