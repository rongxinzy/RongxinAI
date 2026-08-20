// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { i18nService } from '../../services/i18n';
import {
  CoworkAttachmentMediaType,
  CoworkAttachmentMediaTypeByExtension,
} from './constants';
import { CoworkInlineAttachments } from './CoworkInlineAttachments';

describe('CoworkInlineAttachments', () => {
  test('infers CSV media type and removes inline attachments', async () => {
    const onRemove = vi.fn();

    render(
      <CoworkInlineAttachments
        attachments={[{ path: 'C:\\reports\\metrics.csv', name: 'metrics.csv' }]}
        onRemove={onRemove}
      />,
    );

    const attachment = screen.getByText('metrics.csv').closest('.group');
    expect(attachment).toHaveClass('h-8');
    fireEvent.focus(attachment!);

    await waitFor(() => {
      expect(screen.getByText(CoworkAttachmentMediaTypeByExtension.csv)).toBeInTheDocument();
    });
    expect(screen.queryByText(CoworkAttachmentMediaType.Binary)).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(i18nService.t('coworkAttachmentRemove')));
    expect(onRemove).toHaveBeenCalledWith('C:\\reports\\metrics.csv');
  });

  test('shows hover metadata and uses the inline remove transition', async () => {
    render(
      <CoworkInlineAttachments
        attachments={[
          {
            path: 'C:\\reports\\brief.pdf',
            name: 'brief.pdf',
            mediaType: CoworkAttachmentMediaTypeByExtension.pdf,
          },
        ]}
        onRemove={vi.fn()}
      />,
    );

    const attachment = screen.getByText('brief.pdf').closest('[data-slot="hover-card-trigger"]');
    expect(attachment).toHaveClass('h-8');

    const removeButton = screen.getByLabelText(i18nService.t('coworkAttachmentRemove'));
    expect(removeButton).toHaveClass('group-hover:opacity-100');
    expect(attachment?.firstElementChild?.firstElementChild).toHaveClass(
      'group-hover:opacity-0',
    );

    fireEvent.focus(attachment!);

    await waitFor(() => {
      expect(
        screen.getByText(CoworkAttachmentMediaTypeByExtension.pdf),
      ).toBeInTheDocument();
    });
  });

  test('shows an unknown extension instead of the generic binary media type', async () => {
    render(
      <CoworkInlineAttachments
        attachments={[
          {
            path: 'C:\\reports\\archive.custom',
            name: 'archive.custom',
            extension: 'CUSTOM',
          },
        ]}
      />,
    );

    const attachment = screen
      .getByText('archive.custom')
      .closest('[data-slot="hover-card-trigger"]');
    fireEvent.focus(attachment!);

    await waitFor(() => {
      expect(screen.getByText('CUSTOM')).toBeInTheDocument();
    });
    expect(screen.queryByText(CoworkAttachmentMediaType.Binary)).not.toBeInTheDocument();
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
