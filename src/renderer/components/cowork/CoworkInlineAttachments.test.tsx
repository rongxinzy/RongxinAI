// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { i18nService } from '../../services/i18n';
import { CoworkInlineAttachments } from './CoworkInlineAttachments';

describe('CoworkInlineAttachments', () => {
  test('renders documents with the AI Elements inline variant and removes them', () => {
    const onRemove = vi.fn();

    render(
      <CoworkInlineAttachments
        attachments={[{ path: 'C:\\reports\\metrics.csv', name: 'metrics.csv' }]}
        onRemove={onRemove}
      />,
    );

    const attachment = screen.getByText('metrics.csv').closest('.group');
    expect(attachment).toHaveClass('h-8');

    fireEvent.click(screen.getByLabelText(i18nService.t('coworkAttachmentRemove')));
    expect(onRemove).toHaveBeenCalledWith('C:\\reports\\metrics.csv');
  });

  test('loads local image previews and supports keyboard opening', async () => {
    Object.defineProperty(window, 'electron', {
      configurable: true,
      value: {
        dialog: {
          readFileAsDataUrl: vi.fn().mockResolvedValue({
            success: true,
            dataUrl: 'data:image/png;base64,aGVsbG8=',
          }),
        },
      },
    });
    const onOpenImage = vi.fn();

    render(
      <CoworkInlineAttachments
        attachments={[
          {
            path: 'C:\\images\\reference.png',
            name: 'reference.png',
            isImage: true,
          },
        ]}
        onOpenImage={onOpenImage}
      />,
    );

    const preview = await screen.findByRole('img', { name: 'reference.png' });
    const attachment = preview.closest('[role="button"]');
    expect(attachment).toHaveClass('h-8');

    fireEvent.keyDown(attachment!, { key: 'Enter' });
    expect(onOpenImage).toHaveBeenCalledWith({
      src: 'data:image/png;base64,aGVsbG8=',
      alt: 'reference.png',
      name: 'reference.png',
    });
  });
});
