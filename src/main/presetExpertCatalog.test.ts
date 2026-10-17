import { expect, test } from 'vitest';

import path from 'path';

import { extractPresetExpertWorkflow, listPresetExperts } from './presetExpertCatalog';

test('extracts phase titles from the primary workflow only', () => {
  const markdown = `
## 工作流路由
## 标准工作流
### 执行规范
### Phase 1：确认需求
### Phase 2：完成交付
## 快速模式
### Phase 1：不应包含
`;

  expect(extractPresetExpertWorkflow(markdown)).toEqual(['确认需求', '完成交付']);
});

test('loads workflow steps for every bundled preset expert', () => {
  const experts = listPresetExperts(path.resolve('SKILLs'));

  expect(experts).toHaveLength(9);
  expect(experts.every(expert => expert.workflow.length > 0)).toBe(true);
});
