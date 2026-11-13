#!/usr/bin/env python3
"""Analyze the most frequently changed hotspot files in a Git repository."""

import argparse
import csv
import io
import json
import subprocess
import sys
from collections import Counter
from pathlib import Path


def run_git(repo_path: str, args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", repo_path, *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="hotfiles.py",
        description="分析 Git 仓库中变更最频繁的热点文件。",
    )
    parser.add_argument("--repo", default=".", help="仓库路径（默认：当前目录）")
    parser.add_argument("--top", type=int, default=20, help="显示前 N 个文件（默认：20）")
    parser.add_argument("--since", default="", help="起始日期，如 2024-01-01")
    parser.add_argument("--until", default="", help="截止日期")
    parser.add_argument("--author", default="", help="按作者过滤")
    parser.add_argument(
        "--format",
        default="table",
        choices=("table", "csv", "json"),
        help="输出格式：table / csv / json（默认：table）",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    repo_path = args.repo
    if not Path(repo_path, ".git").exists():
        check = run_git(repo_path, ["rev-parse", "--git-dir"])
        if check.returncode != 0:
            print(f"错误: '{repo_path}' 不是一个 Git 仓库", file=sys.stderr)
            return 1

    if args.top < 1:
        print("错误: --top 参数必须是正整数", file=sys.stderr)
        return 1

    git_log_args = ["--no-merges"]
    if args.since:
        git_log_args.append(f"--since={args.since}")
    if args.until:
        git_log_args.append(f"--until={args.until}")
    if args.author:
        git_log_args.append(f"--author={args.author}")

    log_proc = run_git(repo_path, ["log", *git_log_args, "--name-only", "--pretty=format:", "--"])
    if log_proc.returncode != 0:
        print(log_proc.stderr.strip() or "git log 执行失败", file=sys.stderr)
        return 1

    file_counts = Counter(line.strip() for line in log_proc.stdout.splitlines() if line.strip())
    if not file_counts:
        print("未找到符合条件的变更记录。", file=sys.stderr)
        return 0

    top_entries = file_counts.most_common(args.top)
    rows: list[dict[str, object]] = []
    for idx, (file_path, commits) in enumerate(top_entries, start=1):
        numstat_proc = run_git(
            repo_path,
            ["log", "--numstat", "--pretty=format:", *git_log_args, "--", file_path],
        )
        additions = 0
        deletions = 0
        for line in numstat_proc.stdout.splitlines():
            parts = line.split("\t", 2)
            if len(parts) == 3 and parts[0] != "-" and parts[1] != "-":
                try:
                    additions += int(parts[0])
                    deletions += int(parts[1])
                except ValueError:
                    continue
        rows.append(
            {
                "rank": idx,
                "commits": commits,
                "additions": additions,
                "deletions": deletions,
                "file": file_path,
            }
        )

    if args.format == "table":
        print(f"{'排名':<6}  {'提交次数':<8}  {'增/删行数':<8}  文件路径")
        print(f"{'----':<6}  {'--------':<8}  {'--------':<8}  --------")
        for row in rows:
            churn = f"+{row['additions']}/-{row['deletions']}"
            print(f"{row['rank']:<6}  {row['commits']:<8}  {churn:<8}  {row['file']}")
        print("")
        print(f"共分析前 {len(rows)} 个热点文件")
    elif args.format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf, lineterminator="\n")
        writer.writerow(["rank", "commits", "additions", "deletions", "file"])
        for row in rows:
            writer.writerow([row["rank"], row["commits"], row["additions"], row["deletions"], row["file"]])
        sys.stdout.write(buf.getvalue())
    else:
        print(json.dumps(rows, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
