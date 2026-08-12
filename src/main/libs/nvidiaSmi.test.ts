import { expect, test } from 'vitest';

import {
  getNvidiaSmiExecutableCandidates,
  getNvidiaSmiSnapshot,
} from './nvidiaSmi';

test('nvidia-smi candidates include the packaged Windows NVIDIA utility paths', () => {
  const candidates = getNvidiaSmiExecutableCandidates('win32', {
    ProgramFiles: 'C:\\Program Files',
    ProgramW6432: 'C:\\Program Files',
    'ProgramFiles(x86)': 'C:\\Program Files (x86)',
    SystemRoot: 'C:\\Windows',
  });

  expect(candidates[0]).toBe('nvidia-smi.exe');
  expect(candidates).toContain('C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe');
  expect(candidates).toContain('C:\\Windows\\System32\\nvidia-smi.exe');
});

test('nvidia-smi falls back to an explicit Windows path when PATH lookup fails', async () => {
  const attempted: string[] = [];
  const snapshot = await getNvidiaSmiSnapshot(
    async (file) => {
      attempted.push(file);
      if (file === 'nvidia-smi.exe') {
        throw Object.assign(new Error('not found'), { code: 'ENOENT' });
      }
      return {
        stdout: '0, NVIDIA GeForce RTX 4090, 24576, 23000\n1, NVIDIA GeForce RTX 4090, 24576, 23000',
        stderr: '',
      };
    },
    'win32',
    { ProgramFiles: 'C:\\Program Files' },
  );

  expect(attempted).toEqual([
    'nvidia-smi.exe',
    'C:\\Program Files\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe',
  ]);
  expect(snapshot.available).toBe(true);
  expect(snapshot.gpus).toHaveLength(2);
  expect(snapshot.gpus[0]?.memoryTotalMiB).toBe(24576);
});
