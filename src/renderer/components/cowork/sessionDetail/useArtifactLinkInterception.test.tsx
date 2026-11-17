/**
 * @vitest-environment jsdom
 */
import { fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const dispatchMock = vi.fn();
const openAvailableArtifactMock = vi.fn(async (_artifact, open: () => void) => {
  open();
});

vi.mock('react-redux', () => ({
  useDispatch: () => dispatchMock,
}));

vi.mock('../../../services/artifactAvailability', () => ({
  openAvailableArtifact: (...args: unknown[]) =>
    openAvailableArtifactMock(...(args as [unknown, () => void])),
}));

import { selectArtifact } from '../../../store/slices/artifactSlice';
import { ArtifactRole, type Artifact } from '../../../types/artifact';
import { useArtifactLinkInterception } from './useArtifactLinkInterception';

const reportArtifact: Artifact = {
  id: 'artifact-report',
  messageId: 'm-1',
  sessionId: 'session-1',
  type: 'html',
  title: 'report.html',
  content: '<h1>Report</h1>',
  fileName: 'report.html',
  filePath: '/work/report.html',
  source: 'tool',
  role: ArtifactRole.Deliverable,
  declared: true,
  createdAt: 1,
};

function Harness({ artifacts }: { artifacts: Artifact[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useArtifactLinkInterception({
    scrollContainerRef: ref,
    sessionId: 'session-1',
    sessionArtifacts: artifacts,
    cwd: '/work',
  });
  return (
    <div ref={ref}>
      <button type="button" data-local-path="/work/report.html">
        report.html
      </button>
      <button type="button" data-local-path="/work/other.html">
        other.html
      </button>
      <a href="file:///work/report.html">file link</a>
    </div>
  );
}

describe('useArtifactLinkInterception', () => {
  beforeEach(() => {
    dispatchMock.mockClear();
    openAvailableArtifactMock.mockClear();
  });

  test('intercepts Streamdown local-path buttons matching a recorded session artifact', () => {
    const { getByText } = render(<Harness artifacts={[reportArtifact]} />);
    const button = getByText('report.html');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    button.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(openAvailableArtifactMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(selectArtifact('artifact-report'));
  });

  test('leaves non-artifact local-path buttons to their native click handler', () => {
    const { getByText } = render(<Harness artifacts={[reportArtifact]} />);
    const otherButton = getByText('other.html');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    otherButton.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(openAvailableArtifactMock).not.toHaveBeenCalled();
  });

  test('still intercepts file:// anchor links matching a recorded session artifact', () => {
    const { getByText } = render(<Harness artifacts={[reportArtifact]} />);
    fireEvent.click(getByText('file link'));

    expect(openAvailableArtifactMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(selectArtifact('artifact-report'));
  });
});
