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

  it('drops outdated discovery results when user modifies form while test is in flight (P1 race condition)', async () => {
    let resolveTest: (value: MagpieTestProviderResult) => void = () => {};
    const testPromise = new Promise<MagpieTestProviderResult>(resolve => {
      resolveTest = resolve;
    });
    const onTest = vi.fn().mockImplementation(() => testPromise);
    const onSave = vi.fn().mockResolvedValue(true);

    render(
      <ProviderEditDialog open={true} onOpenChange={vi.fn()} onSave={onSave} onTest={onTest} />,
    );

    fireEvent.change(screen.getByPlaceholderText('https://api.openai.com/v1'), {
      target: { value: 'https://api.test.com/v1' },
    });
    fireEvent.change(screen.getByPlaceholderText(i18nService.t('magpieProviderNamePlaceholder')), {
      target: { value: 'Vendor A' },
    });

    // 触发探测（处于 flight 中）
    fireEvent.click(screen.getByText(i18nService.t('magpieTestAndDiscover')));
    expect(onTest).toHaveBeenCalledTimes(1);

    // 在请求未返回期间，用户切换了名字或手动添加了新模型
    const addInput = screen.getByPlaceholderText(i18nService.t('magpieModelAddPlaceholder'));
    fireEvent.change(addInput, { target: { value: 'user-added-during-flight' } });
    fireEvent.click(screen.getByText(i18nService.t('magpieModelAdd')));
    expect(screen.getByText('user-added-during-flight')).toBeTruthy();

    // 此时旧请求返回
    resolveTest({
      ok: true,
      latencyMs: 100,
      modelCount: 2,
      discoveredModels: ['old-flight-model-1', 'old-flight-model-2'],
    });

    // 等待异步完成，旧请求结果不应覆盖用户在请求期间添加的新模型
    await waitFor(() => {
      expect(screen.queryByText('old-flight-model-1')).toBeNull();
      expect(screen.getByText('user-added-during-flight')).toBeTruthy();
    });
  });

  it('preserves comma and trailing whitespace while typing in fallback models (P2)', async () => {
    const onSave = vi.fn().mockResolvedValue(true);
    render(<ProviderEditDialog open={true} onOpenChange={vi.fn()} onSave={onSave} />);

    fireEvent.change(screen.getByPlaceholderText(i18nService.t('magpieProviderNamePlaceholder')), {
      target: { value: 'Fallback Test' },
    });
    fireEvent.change(screen.getByPlaceholderText('https://api.openai.com/v1'), {
      target: { value: 'https://api.test.com/v1' },
    });

    const fallbackInput = screen.getByPlaceholderText(
      i18nService.t('magpieProviderFallbackPlaceholder'),
    ) as HTMLInputElement;

    // 用户键入第一个模型及逗号和空格
    fireEvent.change(fallbackInput, { target: { value: 'model-a, ' } });
    expect(fallbackInput.value).toBe('model-a, ');

    // 用户继续键入第二个模型
    fireEvent.change(fallbackInput, { target: { value: 'model-a, model-b' } });
    expect(fallbackInput.value).toBe('model-a, model-b');

    // 点击保存，验证 payload 携带解析后的数组
    fireEvent.click(screen.getByText(i18nService.t('save')));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          fallback: ['model-a', 'model-b'],
        }),
      );
    });
  });
});
