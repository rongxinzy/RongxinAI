// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { CoworkMessage } from '../../../types/cowork';
import type { Skill } from '../../../types/skill';
import { i18nService } from '../../../services/i18n';
import { formatMessageDateTime } from '../../../utils/tokenFormat';
import { UserBubble } from './UserBubble';

const message: CoworkMessage = {
  id: 'user-message-1',
  type: 'user',
  content: '请帮我分析这个问题',
  timestamp: 1_754_034_400_000,
};

const displayNamedSkill: Skill = {
  id: 'minimax-docx',
  name: 'minimax-docx',
  displayName: '文档',
  description: '',
  enabled: true,
  pinned: false,
  isOfficial: false,
  isBuiltIn: false,
  updatedAt: 0,
  prompt: '',
  skillPath: '',
};

describe('UserBubble', () => {
  test('places the timestamp before copy and re-edit actions', () => {
    render(<UserBubble message={message} skills={[]} onReEdit={vi.fn()} />);

    const timestamp = screen.getByText(formatMessageDateTime(message.timestamp));
    const copyButton = screen.getByLabelText(i18nService.t('copyToClipboard'));
    const reEditButton = screen.getByLabelText(i18nService.t('coworkReEdit'));

    expect(timestamp.compareDocumentPosition(copyButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(
      copyButton.compareDocumentPosition(reEditButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  test('renders copy and re-edit actions for a local user message', () => {
    const onReEdit = vi.fn();

    render(<UserBubble message={message} skills={[]} onReEdit={onReEdit} />);

    expect(screen.getByLabelText(i18nService.t('copyToClipboard'))).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(i18nService.t('coworkReEdit')));

    expect(onReEdit).toHaveBeenCalledWith(message);
  });

  test('does not render re-edit action when the session is remote-managed', () => {
    render(<UserBubble message={message} skills={[]} />);

    expect(screen.getByLabelText(i18nService.t('copyToClipboard'))).toBeInTheDocument();
    expect(screen.queryByLabelText(i18nService.t('coworkReEdit'))).not.toBeInTheDocument();
  });

  test('uses the localized display name for skills in the message summary', () => {
    render(
      <UserBubble
        message={{ ...message, metadata: { skillIds: [displayNamedSkill.id] } }}
        skills={[displayNamedSkill]}
      />,
    );

    expect(screen.getByText('文档')).toBeInTheDocument();
    expect(screen.queryByText('minimax-docx')).not.toBeInTheDocument();
  });

  test('renders sent images as inline attachments and preserves expansion', () => {
    render(
      <UserBubble
        message={{
          ...message,
          metadata: {
            imageAttachments: [
              { name: 'screenshot.png', mimeType: 'image/png', base64Data: 'aW1hZ2U=' },
            ],
          },
        }}
        skills={[]}
      />,
    );

    const image = screen.getByRole('img', { name: 'screenshot.png' });
    const attachment = image.closest('[role="button"]');

    expect(attachment).not.toBeNull();
    expect(attachment).toHaveClass('h-8');
    expect(image).toHaveClass('size-full');

    fireEvent.click(attachment!);

    const expandedImage = screen.getAllByRole('img', { name: 'screenshot.png' })[1];
    expect(expandedImage).toHaveClass('max-h-[72vh]');
    expect(expandedImage).toHaveClass('max-w-[min(75vw,960px)]');
  });

  test('renders a local preview for an image kept as a file attachment', async () => {
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

    render(
      <UserBubble
        message={{
          ...message,
          metadata: {
            fileAttachments: [
              {
                name: 'reference.png',
                path: '/tmp/reference.png',
                extension: 'PNG',
                isImage: true,
              },
            ],
          },
        }}
        skills={[]}
      />,
    );

    const preview = await screen.findByAltText('reference.png');
    const attachment = preview.closest('[role="button"]');
    expect(preview).toHaveAttribute('src', 'data:image/png;base64,aGVsbG8=');
    expect(attachment).toHaveClass('h-8');
    expect(screen.queryByText('PNG')).not.toBeInTheDocument();
  });

  test('restores an attachment card from a legacy Windows input-file prompt line', () => {
    render(
      <UserBubble
        message={{
          ...message,
          content: '输入文件：C:\\Users\\whz\\Downloads\\brief.docx\n\n请总结这份文件',
        }}
        skills={[]}
      />,
    );

    const attachment = screen.getByText('brief.docx').closest('.group');
    expect(attachment).toHaveClass('h-8');
    expect(screen.queryByText('DOCX')).not.toBeInTheDocument();
    expect(screen.getByText('请总结这份文件')).toBeInTheDocument();
    expect(screen.queryByText(/输入文件：C:/)).not.toBeInTheDocument();
  });

  test('restores an attachment from an English UNC prompt line after language changes', () => {
    render(
      <UserBubble
        message={{
          ...message,
          content: String.raw`Input Files: \\nas\shared\contract.docx`,
        }}
        skills={[]}
      />,
    );

    const attachment = screen.getByText('contract.docx').closest('.group');
    expect(attachment).toHaveClass('h-8');
    expect(screen.queryByText('DOCX')).not.toBeInTheDocument();
    expect(screen.queryByText(/Input Files:/)).not.toBeInTheDocument();
  });
});
