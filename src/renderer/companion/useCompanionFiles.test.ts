// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { CompanionWindowApi } from '../../shared/companion/types';
import type {
  CompanionAttachment,
  CompanionIncomingFile,
} from '../../shared/companion/attachments';
import { COMPANION_MAX_ATTACHMENT_BYTES } from '../../shared/companion/attachments';
import { useCompanionFiles } from './useCompanionFiles';

afterEach(cleanup);
function fixture() {
  let active = 'pet';
  let attachments: CompanionAttachment[] = [];
  const stageFile = vi.fn(
    async (_pet: string, file: CompanionIncomingFile): Promise<CompanionAttachment> => ({
      id: crypto.randomUUID(),
      name: file.name,
      bytes: file.data.byteLength,
    }),
  );
  const chooseFiles = vi.fn(async () => [{ id: crypto.randomUUID(), name: 'chosen.md', bytes: 1 }]);
  const onError = vi.fn();
  const hook = renderHook(() =>
    useCompanionFiles({
      api: { stageFile, chooseFiles } as unknown as CompanionWindowApi,
      disabled: false,
      activePetId: () => active,
      attachments: () => attachments,
      onChange: next => {
        attachments = next;
      },
      onError,
      onFocus: vi.fn(),
    }),
  );
  return {
    ...hook,
    stageFile,
    chooseFiles,
    onError,
    attachments: () => attachments,
    switchPet: () => {
      active = 'other-pet';
      attachments = [];
    },
  };
}

test('file transfers serialize, keep real bytes and share the picker lock', async () => {
  const f = fixture();
  await act(async () => {
    const incoming = f.result.current.addFiles([
      new File(['中文 evidence'], 'pasted.txt', { type: 'text/plain' }),
    ]);
    await f.result.current.chooseFiles();
    await incoming;
  });
  expect(f.chooseFiles).not.toHaveBeenCalled();
  expect(f.stageFile).toHaveBeenCalledOnce();
  expect(new TextDecoder().decode(f.stageFile.mock.calls[0][1].data)).toBe('中文 evidence');
  expect(f.attachments()).toMatchObject([{ name: 'pasted.txt' }]);
  expect(f.result.current.choosingFiles).toBe(false);
});

test('over-limit batches are rejected before staging any file', async () => {
  const f = fixture();
  await act(async () => {
    await f.result.current.addFiles(Array.from({ length: 11 }, () => new File(['a'], 'notes.txt')));
  });
  expect(f.onError).toHaveBeenLastCalledWith('companionFilesLimit');
  const large = new File(['a'], 'large.txt');
  Object.defineProperty(large, 'size', { value: COMPANION_MAX_ATTACHMENT_BYTES + 1 });
  await act(async () => {
    await f.result.current.addFiles([new File(['b'], 'valid.txt'), large]);
  });
  expect(f.onError).toHaveBeenLastCalledWith('companionFileTooLarge');
  expect(f.stageFile).not.toHaveBeenCalled();
});

test('late staging cannot cross an identity switch or start the next private file', async () => {
  const f = fixture();
  let finish: (value: CompanionAttachment) => void = () => {};
  f.stageFile.mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve;
      }),
  );
  let incoming: Promise<void>;
  await act(async () => {
    incoming = f.result.current.addFiles([new File(['a'], 'old.txt'), new File(['b'], 'next.txt')]);
  });
  await vi.waitFor(() => expect(f.stageFile).toHaveBeenCalledOnce());
  f.switchPet();
  await act(async () => {
    finish({ id: crypto.randomUUID(), name: 'old.txt', bytes: 1 });
    await incoming!;
  });
  expect(f.attachments()).toEqual([]);
  expect(f.stageFile).toHaveBeenCalledOnce();
});

test('an acknowledged first file survives a later failure', async () => {
  const f = fixture();
  f.stageFile.mockImplementationOnce(async (_pet, file) => ({
    id: crypto.randomUUID(),
    name: file.name,
    bytes: file.data.byteLength,
  }));
  f.stageFile.mockRejectedValueOnce(new Error('Disconnected'));
  await act(async () => {
    await f.result.current.addFiles([new File(['a'], 'kept.txt'), new File(['b'], 'retry.txt')]);
  });
  expect(f.attachments()).toMatchObject([{ name: 'kept.txt' }]);
  expect(f.onError).toHaveBeenLastCalledWith('companionFilesFailed');
});
