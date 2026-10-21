// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { MagpieTestProviderResult } from '../../../../shared/magpie/types';
import { i18nService } from '../../../services/i18n';
import { ProviderEditDialog } from './ProviderEditDialog';

describe('ProviderEditDialog', () => {
  beforeEach(() => {
    i18nService.setLanguage('zh', { persist: false });
  });

  it('automatically fills discovered models when connection test succeeds and list is untouched', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    const onTest = vi.fn().mockResolvedValue({
      ok: true,
      latencyMs: 120,
      modelCount: 2,
      discoveredModels: ['online-model-a', 'online-model-b'],
    } satisfies MagpieTestProviderResult);

    render(
      <ProviderEditDialog open={true} onOpenChange={vi.fn()} onSave={onSave} onTest={onTest} />,
    );

    // 填写名称与 Base URL
    fireEvent.change(screen.getByPlaceholderText(i18nService.t('magpieProviderNamePlaceholder')), {
      target: { value: 'Test Provider' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://api.openai.com/v1'), {
      target: { value: 'https://api.test.com/v1' },
    });

    // 点击测试并拉取模型按钮
    const testButton = screen.getByText(i18nService.t('magpieTestAndDiscover'));
    fireEvent.click(testButton);

    await waitFor(() => {
      expect(onTest).toHaveBeenCalled();
      // 验证自动填入的标签胶囊出现在页面上
      expect(screen.getByText('online-model-a')).toBeTruthy();
      expect(screen.getByText('online-model-b')).toBeTruthy();
    });

    // 点击保存，验证 payload 携带自动填入的模型
    fireEvent.click(screen.getByText(i18nService.t('save')));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          models: ['online-model-a', 'online-model-b'],
        }),
      );
    });
  });

  it('shows conflict resolution bar when user has custom models and online discovery finds models', async () => {
    const onTest = vi.fn().mockResolvedValue({
      ok: true,
      latencyMs: 80,
      modelCount: 2,
      discoveredModels: ['discovered-x', 'discovered-y'],
    } satisfies MagpieTestProviderResult);

    render(
      <ProviderEditDialog
        open={true}
        onOpenChange={vi.fn()}
        onSave={vi.fn().mockResolvedValue(true)}
        onTest={onTest}
      />,
    );

    // 用户手动添加一个自定义模型
    const addInput = screen.getByPlaceholderText(i18nService.t('magpieModelAddPlaceholder'));
    fireEvent.change(addInput, { target: { value: 'my-custom-model' } });
    fireEvent.click(screen.getByText(i18nService.t('magpieModelAdd')));

    expect(screen.getByText('my-custom-model')).toBeTruthy();

    // 填入 Base URL 并测试拉取
    fireEvent.change(screen.getByPlaceholderText('https://api.openai.com/v1'), {
      target: { value: 'https://api.test.com/v1' },
    });
    fireEvent.click(screen.getByText(i18nService.t('magpieTestAndDiscover')));

    await waitFor(() => {
      // 出现冲突操作条
      expect(screen.getByText(i18nService.t('magpieModelConflictReplace'))).toBeTruthy();
      expect(screen.getByText(i18nService.t('magpieModelConflictAppend'))).toBeTruthy();
    });

    // 点击增量追加 [追加未有]
    fireEvent.click(screen.getByText(i18nService.t('magpieModelConflictAppend')));

    // 原有的 my-custom-model 和新追加的 discovered-x / y 都应该存在
    expect(screen.getByText('my-custom-model')).toBeTruthy();
    expect(screen.getByText('discovered-x')).toBeTruthy();
    expect(screen.getByText('discovered-y')).toBeTruthy();
  });

  it('allows switching to text mode and supports manual comma text editing', async () => {
    render(
      <ProviderEditDialog
        open={true}
        onOpenChange={vi.fn()}
        onSave={vi.fn().mockResolvedValue(true)}
      />,
    );

    // 切换到纯文本模式
    fireEvent.click(screen.getByText(i18nService.t('magpieModelModeText')));

    const textInput = screen.getByPlaceholderText(i18nService.t('magpieProviderModelsHint'));
    fireEvent.change(textInput, { target: { value: 'model-1, model-2' } });

    // 切回标签模式验证
    fireEvent.click(screen.getByText(i18nService.t('magpieModelModeChips')));
    expect(screen.getByText('model-1')).toBeTruthy();
    expect(screen.getByText('model-2')).toBeTruthy();
  });
});
