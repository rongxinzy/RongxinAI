// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { ArtifactRole, type Artifact } from '@/types/artifact';

import CodeRenderer from './CodeRenderer';

const makeCodeArtifact = (overrides: Partial<Artifact> = {}): Artifact => ({
  id: 'artifact-code-1',
  messageId: 'message-1',
  sessionId: 'session-1',
  type: 'code',
  title: 'main.ts',
  content: '',
  fileName: 'main.ts',
  filePath: '',
  source: 'tool',
  role: ArtifactRole.Deliverable,
  declared: true,
  createdAt: 0,
  ...overrides,
});

describe('CodeRenderer', () => {
  test('shows placeholder when content is empty', () => {
    render(<CodeRenderer artifact={makeCodeArtifact()} />);

    expect(screen.getByText('No content')).toBeTruthy();
  });

  test('highlights code with an explicit language via shiki tokens', async () => {
    render(
      <CodeRenderer
        artifact={makeCodeArtifact({
          language: 'python',
          content: 'def greet():\n    return "hi"',
        })}
      />,
    );

    // Shiki tokenization is async; wait for colored spans to land.
    await screen.findByText(/def/, { selector: 'span[style*="color"]' });
    const code = document.querySelector('pre');
    expect(code?.textContent).toContain('def greet():');
    expect(code?.textContent).toContain('return "hi"');
  });

  test('maps artifact types to highlight languages', async () => {
    render(
      <CodeRenderer
        artifact={makeCodeArtifact({
          type: 'html',
          language: undefined,
          content: '<p class="big">hi</p>',
        })}
      />,
    );

    await screen.findByText(/<p/, { selector: 'span[style*="color"]' });
    expect(document.querySelector('pre')?.textContent).toContain('class="big"');
  });

  test('unknown languages fall back to plain text rendering', async () => {
    render(
      <CodeRenderer
        artifact={makeCodeArtifact({
          language: 'not-a-language',
          content: 'plain body',
        })}
      />,
    );

    // Plain fallback renders raw tokens without loading any shiki grammar:
    // spans exist but none carries a syntax color.
    await screen.findByText('plain body');
    const colored = Array.from(document.querySelectorAll('span[style*="color"]')).filter(
      span => (span as HTMLElement).style.color !== 'inherit',
    );
    expect(colored.length).toBe(0);
  });

  test('oversized content skips highlighting and renders as plain pre', () => {
    const bigContent = 'x'.repeat(50_001);
    render(
      <CodeRenderer artifact={makeCodeArtifact({ language: 'python', content: bigContent })} />,
    );

    const pre = document.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre?.textContent?.length).toBe(50_001);
  });
});
