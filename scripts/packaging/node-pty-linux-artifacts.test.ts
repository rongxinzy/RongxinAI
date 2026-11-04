import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  LINUX_ELECTRON_NATIVE_ARTIFACTS,
  LINUX_NODE_PTY_BINDING,
} from './node-pty-linux-artifacts.cjs';

const root = path.resolve(import.meta.dirname, '../..');

describe('node-pty Linux packaging artifacts', () => {
  test('requires pty.node and better_sqlite3 but not macOS-only spawn-helper', () => {
    expect(LINUX_NODE_PTY_BINDING).toBe('node_modules/node-pty/build/Release/pty.node');
    expect(LINUX_ELECTRON_NATIVE_ARTIFACTS).toEqual([
      LINUX_NODE_PTY_BINDING,
      'node_modules/better-sqlite3/build/Release/better_sqlite3.node',
    ]);
    expect(LINUX_ELECTRON_NATIVE_ARTIFACTS.some(entry => entry.includes('spawn-helper'))).toBe(
      false,
    );
  });

  test('matches node-pty binding.gyp (spawn-helper target is macOS-only)', () => {
    const bindingGyp = readFileSync(path.join(root, 'node_modules/node-pty/binding.gyp'), 'utf8');
    expect(bindingGyp).toMatch(/'target_name': 'spawn-helper'/);
    expect(bindingGyp).toMatch(/\['OS=="mac"'/);
  });
});
