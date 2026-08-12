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
    expect(copyButton.compareDocumentPosition(reEditButton) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
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
    expect(preview).toHaveAttribute('src', 'data:image/png;base64,aGVsbG8=');
    expect(screen.queryByText('PNG')).not.toBeInTheDocument();
  });
});
