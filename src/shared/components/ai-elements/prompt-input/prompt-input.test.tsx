// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { beforeAll, beforeEach, expect, test, vi } from 'vitest';

import type { PromptInputControllerProps } from './provider';
import {
  PromptInput,
  PromptInputBody,
  PromptInputProvider,
  PromptInputTextarea,
  usePromptInputController,
} from './index';

// jsdom does not implement blob URL APIs.
let blobSeq = 0;
const createObjectURL = vi.fn(() => `blob:mock-${++blobSeq}`);
const revokeObjectURL = vi.fn();

beforeAll(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    value: createObjectURL,
    configurable: true,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    value: revokeObjectURL,
    configurable: true,
  });
});

beforeEach(() => {
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
});

const file = (name: string, type: string, content = 'x') => new File([content], name, { type });

const getFileInput = (container: HTMLElement) => {
  const input = container.querySelector('input[type="file"]');
  if (!input) {
    throw new Error('file input not found');
  }
  return input as HTMLInputElement;
};

const pickFiles = (input: HTMLInputElement, files: File[]) => {
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  fireEvent.change(input);
};

const ControllerProbe = ({
  onController,
}: {
  onController: (controller: PromptInputControllerProps) => void;
}) => {
  onController(usePromptInputController());
  return null;
};

test('usePromptInputController throws when used outside PromptInputProvider', () => {
  expect(() =>
    render(
      React.createElement(() => {
        usePromptInputController();
        return null;
      }),
    ),
  ).toThrow(/PromptInputProvider/);
});

test('controller exposes initial provider input value', () => {
  const captured: { current: PromptInputControllerProps | null } = { current: null };
  render(
    React.createElement(
      PromptInputProvider,
      { initialInput: 'hello' },
      React.createElement(ControllerProbe, { onController: c => (captured.current = c) }),
    ),
  );
  expect(captured.current?.textInput.value).toBe('hello');
});

test('accept mismatch reports accept error and adds nothing', () => {
  const onError = vi.fn();
  const { container } = render(
    React.createElement(
      PromptInput,
      { accept: 'image/*', onError, onSubmit: () => {} },
      React.createElement(PromptInputBody, null, React.createElement(PromptInputTextarea)),
    ),
  );

  pickFiles(getFileInput(container), [file('notes.txt', 'text/plain')]);

  expect(onError).toHaveBeenCalledWith(
    expect.objectContaining({ code: 'accept', message: 'No files match the accepted types.' }),
  );
  expect(createObjectURL).not.toHaveBeenCalled();
});

test('oversized file reports max_file_size error and is not added', () => {
  const onError = vi.fn();
  const { container } = render(
    React.createElement(
      PromptInput,
      { maxFileSize: 4, onError, onSubmit: () => {} },
      React.createElement(PromptInputBody, null, React.createElement(PromptInputTextarea)),
    ),
  );

  pickFiles(getFileInput(container), [file('big.bin', 'application/octet-stream', '12345678')]);

  expect(onError).toHaveBeenCalledWith(
    expect.objectContaining({
      code: 'max_file_size',
      message: 'All files exceed the maximum size.',
    }),
  );
  expect(createObjectURL).not.toHaveBeenCalled();
});

test('matching file is added with a blob url in provider mode', () => {
  const captured: { current: PromptInputControllerProps | null } = { current: null };
  const { container } = render(
    React.createElement(
      PromptInputProvider,
      null,
      React.createElement(
        PromptInput,
        { accept: 'image/*', onSubmit: () => {} },
        React.createElement(PromptInputBody, null, React.createElement(PromptInputTextarea)),
        React.createElement(ControllerProbe, { onController: c => (captured.current = c) }),
      ),
    ),
  );

  pickFiles(getFileInput(container), [file('pic.png', 'image/png')]);

  expect(captured.current?.attachments.files).toHaveLength(1);
  expect(captured.current?.attachments.files[0].url).toBe('blob:mock-1');
  expect(captured.current?.attachments.files[0].filename).toBe('pic.png');
});

test('maxFiles caps provider additions and reports max_files', () => {
  const onError = vi.fn();
  const captured: { current: PromptInputControllerProps | null } = { current: null };
  const { container } = render(
    React.createElement(
      PromptInputProvider,
      null,
      React.createElement(
        PromptInput,
        { maxFiles: 1, onError, onSubmit: () => {} },
        React.createElement(PromptInputBody, null, React.createElement(PromptInputTextarea)),
        React.createElement(ControllerProbe, { onController: c => (captured.current = c) }),
      ),
    ),
  );

  pickFiles(getFileInput(container), [file('a.png', 'image/png'), file('b.png', 'image/png')]);

  expect(onError).toHaveBeenCalledWith(
    expect.objectContaining({
      code: 'max_files',
      message: 'Too many files. Some were not added.',
    }),
  );
  expect(captured.current?.attachments.files).toHaveLength(1);
});

test('Backspace on empty textarea removes the last attachment', () => {
  const { container } = render(
    React.createElement(
      PromptInput,
      { onSubmit: () => {} },
      React.createElement(PromptInputBody, null, React.createElement(PromptInputTextarea)),
    ),
  );

  pickFiles(getFileInput(container), [file('pic.png', 'image/png')]);
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  const blobUrl = createObjectURL.mock.results[0]?.value;

  const textarea = container.querySelector('textarea');
  if (!textarea) {
    throw new Error('textarea not found');
  }
  fireEvent.keyDown(textarea, { key: 'Backspace' });

  expect(revokeObjectURL).toHaveBeenCalledWith(blobUrl);
});

test('Enter in the textarea submits the form', async () => {
  const onSubmit = vi.fn();
  const { container } = render(
    React.createElement(
      PromptInput,
      { onSubmit },
      React.createElement(PromptInputBody, null, React.createElement(PromptInputTextarea)),
    ),
  );

  const textarea = container.querySelector('textarea');
  if (!textarea) {
    throw new Error('textarea not found');
  }
  await act(async () => {
    fireEvent.keyDown(textarea, { key: 'Enter' });
  });

  expect(onSubmit).toHaveBeenCalledWith(
    expect.objectContaining({ text: '', files: [] }),
    expect.anything(),
  );
});
