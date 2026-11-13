#!/usr/bin/env python3
"""Analyze code ownership across contributors in a Git repository."""

import argparse
import csv
import io
import json
import re
import subprocess
import sys
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
        prog="ownership.py",
        description="分析 Git 仓库中代码的归属关系（谁拥有哪些代码）。",
    )
    parser.add_argument("--repo", default=".", help="仓库路径（默认：当前目录）")
    parser.add_argument("--path", dest="sub_path", default="", help="分析指定子目录或文件")
    parser.add_argument("--top", type=int, default=10, help="显示前 N 位贡献者（默认：10）")
    parser.add_argument("--since", default="", help="起始日期，如 2024-01-01")
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

    shortlog_args = ["shortlog", "-sne", "--no-merges"]
    if args.since:
        shortlog_args.append(f"--since={args.since}")
    shortlog_args.append("HEAD")
    if args.sub_path:
        shortlog_args.extend(["--", args.sub_path])

    shortlog_proc = run_git(repo_path, shortlog_args)
    lines = [line for line in shortlog_proc.stdout.splitlines() if line.strip()]
    if not lines:
        print("未找到符合条件的贡献记录。", file=sys.stderr)
        return 0

    parsed_entries: list[tuple[int, str]] = []
    total_commits = 0
    for line in lines:
        match = re.match(r"^\s*(\d+)\s+(.+?)\s*(?:<.*)?$", line)
        if not match:
            continue
        count = int(match.group(1))
        author = match.group(2).strip()
        total_commits += count
        parsed_entries.append((count, author))

    if total_commits == 0:
        total_commits = 1

    path_args = ["--", args.sub_path] if args.sub_path else []
    since_args = [f"--since={args.since}"] if args.since else []

    contributors: list[dict[str, object]] = []
    for idx, (count, author) in enumerate(parsed_entries[: args.top], start=1):
        pct = round((count / total_commits) * 100, 1)

        numstat_proc = run_git(
            repo_path,
            ["log", "--numstat", "--no-merges", "--pretty=format:", f"--author={author}", *since_args, "HEAD", *path_args],
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

        last_proc = run_git(
            repo_path,
            ["log", "-1", "--format=%ai", "--no-merges", f"--author={author}", *since_args, "HEAD", *path_args],
        )
        last_active = last_proc.stdout.strip().split()[0] if last_proc.stdout.strip() else "N/A"

        contributors.append(
            {
                "rank": idx,
                "author": author,
                "commits": count,
                "percentage": pct,
                "additions": additions,
                "deletions": deletions,
                "last_active": last_active,
            }
        )

    if args.format == "table":
        scope_desc = args.sub_path or "整个仓库"
        print(f"代码归属分析 — 范围: {scope_desc}")
        print("")
        print(f"{'排名':<6}  {'贡献者':<20}  {'提交次数':<10}  {'占比':<8}  {'增/删行数':<14}  最近活跃")
        print(f"{'----':<6}  {'-' * 20}  {'-' * 10}  {'-' * 8}  {'-' * 14}  {'-' * 10}")
        for row in contributors:
            churn = f"+{row['additions']}/-{row['deletions']}"
            pct_str = f"{row['percentage']:.1f}%"
            print(
                f"{row['rank']:<6}  {row['author']:<20}  {row['commits']:<10}  {pct_str:<8}  {churn:<14}  {row['last_active']}"
            )
        print("")
        print(f"总提交数: {total_commits} | 显示前 {len(contributors)} 位贡献者")
    elif args.format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf, lineterminator="\n")
        writer.writerow(["rank", "author", "commits", "percentage", "additions", "deletions", "last_active"])
        for row in contributors:
            writer.writerow(
                [
                    row["rank"],
                    row["author"],
                    row["commits"],
                    f"{row['percentage']:.1f}",
                    row["additions"],
                    row["deletions"],
                    row["last_active"],
                ]
            )
        sys.stdout.write(buf.getvalue())
    else:
        payload = {
            "total_commits": total_commits,
            "scope": args.sub_path or ".",
            "contributors": contributors,
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
