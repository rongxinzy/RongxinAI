#!/usr/bin/env python3
"""Resolve and execute the DOCX CLI used by SKILL.md's CLI shorthand.

Resolution order:
  1. $ZHIYUAN_DOCX_CLI                          (explicit override, tests, enterprise builds)
  2. <skill>/runtime/MiniMaxAIDocx(.Cli)(.exe)  (self-contained publish, needs no .NET)
  3. dotnet run --project scripts/dotnet/MiniMaxAIDocx.Cli
"""

import os
import shutil
import subprocess
import sys
from pathlib import Path


def is_executable_file(path: Path) -> bool:
    if not path.is_file():
        return False
    if os.name == "nt":
        return True
    return os.access(path, os.X_OK)


def main() -> int:
    script_dir = Path(__file__).resolve().parent
    skill_dir = script_dir.parent
    args = sys.argv[1:]

    override = os.environ.get("ZHIYUAN_DOCX_CLI", "").strip()
    if override:
        override_path = Path(override)
        if is_executable_file(override_path):
            return subprocess.run([str(override_path), *args]).returncode

    candidates = [
        skill_dir / "runtime" / "MiniMaxAIDocx.Cli.exe",
        skill_dir / "runtime" / "MiniMaxAIDocx.exe",
        skill_dir / "runtime" / "MiniMaxAIDocx.Cli",
        skill_dir / "runtime" / "MiniMaxAIDocx",
    ]
    for candidate in candidates:
        if is_executable_file(candidate):
            return subprocess.run([str(candidate), *args]).returncode

    dotnet = shutil.which("dotnet")
    if dotnet:
        project_dir = skill_dir / "scripts" / "dotnet" / "MiniMaxAIDocx.Cli"
        return subprocess.run(
            [dotnet, "run", "--project", str(project_dir), "--", *args]
        ).returncode

    print(
        "docx CLI unavailable: no bundled runtime and no dotnet SDK on PATH.",
        file=sys.stderr,
    )
    print("Build it with: node scripts/build-docx-runtime.cjs", file=sys.stderr)
    return 3


if __name__ == "__main__":
    raise SystemExit(main())
