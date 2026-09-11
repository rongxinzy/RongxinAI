// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { expect, test } from 'vitest';

import type { CoworkMessage } from '../../../types/cowork';
import { formatMessageDateTime } from '../../../utils/tokenFormat';
import { AssistantBubble } from './AssistantBubble';

const message: CoworkMessage = {
  id: 'assistant-message-1',
  type: 'assistant',
  content: '已完成。',
  timestamp: 1_754_034_400_000,
};

test('shows the timestamp below an assistant response', () => {
  render(<AssistantBubble message={message} />);

  expect(screen.getByText(formatMessageDateTime(message.timestamp))).toBeInTheDocument();
});
