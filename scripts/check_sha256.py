#!/usr/bin/env python3
"""Calculate the SHA-256 checksum of a file."""

from __future__ import annotations

import argparse
import hashlib
from pathlib import Path


DEFAULT_FILE_PATH = Path(r'D:\Minimax-h3.tar')
CHUNK_SIZE_BYTES = 1024 * 1024


def calculate_sha256(file_path: Path) -> str:
  digest = hashlib.sha256()

  with file_path.open('rb') as file:
    while chunk := file.read(CHUNK_SIZE_BYTES):
      digest.update(chunk)

  return digest.hexdigest()


def main() -> int:
  parser = argparse.ArgumentParser(
    description='Calculate a file SHA-256 checksum.',
  )
  parser.add_argument(
    'file_path',
    nargs='?',
    type=Path,
    default=DEFAULT_FILE_PATH,
    help=f'File to check (default: {DEFAULT_FILE_PATH})',
  )
  args = parser.parse_args()
  file_path: Path = args.file_path

  if not file_path.is_file():
    print(f'File not found or not a regular file: {file_path}')
    return 1

  print(f'SHA-256: {calculate_sha256(file_path)}')
  print(f'File: {file_path}')
  return 0


if __name__ == '__main__':
  raise SystemExit(main())
