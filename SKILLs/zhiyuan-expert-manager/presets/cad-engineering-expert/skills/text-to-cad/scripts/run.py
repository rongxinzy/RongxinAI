from __future__ import annotations

import argparse
import os
import runpy
import sys
from pathlib import Path

from runtime import SKILL_NAMES, ensure_runtime


def resolve_entry(runtime_root: Path, skill_name: str, entry: str) -> Path:
    skill_root = (runtime_root / "skills" / skill_name).resolve()
    target = (skill_root / entry).resolve()
    try:
        target.relative_to(skill_root)
    except ValueError as error:
        raise RuntimeError(f"Entry escapes the selected workflow: {entry}") from error
    if target.is_dir():
        if not (target / "__main__.py").is_file():
            raise RuntimeError(f"Python package entry has no __main__.py: {entry}")
        return target
    if not target.is_file() or target.suffix.lower() != ".py":
        raise RuntimeError(f"Only Python files or package entries are supported: {entry}")
    return target


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a checked text-to-cad Python entry")
    parser.add_argument("skill", choices=SKILL_NAMES)
    parser.add_argument("entry")
    parser.add_argument("arguments", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    try:
        runtime_root = ensure_runtime()
        target = resolve_entry(runtime_root, args.skill, args.entry)
    except (OSError, RuntimeError) as error:
        print(f"text-to-cad runtime failed: {error}", file=sys.stderr)
        return 1

    os.environ["TEXT_TO_CAD_RUNTIME_ROOT"] = str(runtime_root)
    os.environ["TEXT_TO_CAD_SKILL_ROOT"] = str(runtime_root / "skills" / args.skill)
    os.environ["ZHIYUAN_SKILL_PYTHON_BIN"] = str(Path(sys.executable).resolve())
    sys.argv = [str(target), *args.arguments]
    runpy.run_path(str(target), run_name="__main__")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
