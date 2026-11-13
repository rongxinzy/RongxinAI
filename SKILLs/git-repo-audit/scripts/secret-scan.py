#!/usr/bin/env python3
"""Scan Git history for leaked secrets and sensitive credentials."""

import argparse
import csv
import io
import json
import re
import subprocess
import sys
from pathlib import Path

PATTERNS_HIGH: list[tuple[str, re.Pattern[str]]] = [
    ("AWS Access Key", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("Private Key", re.compile(r"-----BEGIN (?:RSA |DSA |EC |OPENSSH )?PRIVATE KEY-----")),
    ("GitHub Token", re.compile(r"gh[pousr]_[A-Za-z0-9_]{36,}")),
    ("GitLab Token", re.compile(r"glpat-[A-Za-z0-9\-_]{20,}")),
    ("Slack Token", re.compile(r"xox[bprs]-[a-zA-Z0-9\-]{10,}")),
    ("OpenAI API Key", re.compile(r"sk-[a-zA-Z0-9]{32,}")),
    ("JWT Token", re.compile(r"eyJ[a-zA-Z0-9_-]{20,}\.eyJ[a-zA-Z0-9_-]{20,}\.[a-zA-Z0-9_\-]{20,}")),
]

PATTERNS_MEDIUM: list[tuple[str, re.Pattern[str]]] = [
    ("AWS Secret Key", re.compile(r"aws_secret_access_key\s*[=:]\s*[A-Za-z0-9/+=]{30,}")),
    (
        "Azure Credential",
        re.compile(r"AZURE[_-]?(?:CLIENT|TENANT|SUBSCRIPTION)[_-]?(?:SECRET|KEY|ID)\s*[=:]\s*['\"][^'\"]{8,}"),
    ),
    ("SendGrid Key", re.compile(r"SG\.[a-zA-Z0-9_-]{22}\.[a-zA-Z0-9_-]{43}")),
    ("Square Token", re.compile(r"sq0[a-z]{3}-[a-zA-Z0-9_-]{22,}")),
    ("Stripe Key", re.compile(r"sk_(?:live|test)_[a-zA-Z0-9]{24,}")),
    ("Stripe Restricted Key", re.compile(r"rk_(?:live|test)_[a-zA-Z0-9]{24,}")),
    ("Twilio SID", re.compile(r"AC[a-f0-9]{32}")),
    ("Slack Webhook", re.compile(r"hooks\.slack\.com/services/T[A-Z0-9]{8}/B[A-Z0-9]{8,}/[a-zA-Z0-9]{24}")),
]

PATTERNS_LOW: list[tuple[str, re.Pattern[str]]] = [
    ("Generic API Key", re.compile(r"api[_-]?key\s*[=:]\s*['\"][a-zA-Z0-9_\-]{16,}['\"]", re.IGNORECASE)),
    ("Generic API Secret", re.compile(r"api[_-]?secret\s*[=:]\s*['\"][a-zA-Z0-9_\-]{16,}['\"]", re.IGNORECASE)),
    ("Hardcoded Password", re.compile(r"password\s*[=:]\s*['\"][^'\"]{8,}['\"]", re.IGNORECASE)),
    ("Generic Secret Key", re.compile(r"secret[_-]?key\s*[=:]\s*['\"][a-zA-Z0-9_\-]{16,}['\"]", re.IGNORECASE)),
    ("Generic Access Token", re.compile(r"access[_-]?token\s*[=:]\s*['\"][a-zA-Z0-9_\-]{16,}['\"]", re.IGNORECASE)),
]

SEVERITY_ORDER = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}


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
        prog="secret-scan.py",
        description="扫描 Git 历史中的密钥和敏感信息泄露。",
    )
    parser.add_argument("--repo", default=".", help="仓库路径（默认：当前目录）")
    parser.add_argument("--branch", default="", help="扫描指定分支（默认：所有分支）")
    parser.add_argument("--since", default="", help="起始日期，如 2024-01-01")
    parser.add_argument(
        "--format",
        default="table",
        choices=("table", "csv", "json"),
        help="输出格式：table / csv / json（默认：table）",
    )
    parser.add_argument(
        "--severity",
        default="low",
        choices=("low", "medium", "high"),
        help="最低严重级别：low / medium / high（默认：low）",
    )
    return parser


def select_rules(min_severity: str) -> list[tuple[str, str, re.Pattern[str]]]:
    rules: list[tuple[str, str, re.Pattern[str]]] = [
        ("HIGH", name, pattern) for name, pattern in PATTERNS_HIGH
    ]
    if min_severity in ("medium", "low"):
        rules.extend(("MEDIUM", name, pattern) for name, pattern in PATTERNS_MEDIUM)
    if min_severity == "low":
        rules.extend(("LOW", name, pattern) for name, pattern in PATTERNS_LOW)
    return rules


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    repo_path = args.repo
    if not Path(repo_path, ".git").exists():
        check = run_git(repo_path, ["rev-parse", "--git-dir"])
        if check.returncode != 0:
            print(f"错误: '{repo_path}' 不是一个 Git 仓库", file=sys.stderr)
            return 1

    rules = select_rules(args.severity)
    log_args = ["log", args.branch or "--all", "--diff-filter=ACMR", "-p"]
    if args.since:
        log_args.append(f"--since={args.since}")

    proc = subprocess.Popen(
        ["git", "-C", repo_path, *log_args],
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        text=True,
        encoding="utf-8",
        errors="replace",
    )

    findings: list[dict[str, str]] = []
    current_commit = ""
    current_file = ""
    current_date = ""
    current_author = ""

    assert proc.stdout is not None
    for raw_line in proc.stdout:
        line = raw_line.rstrip("\r\n")
        if line.startswith("commit "):
            m = re.match(r"^commit\s+([a-f0-9]{40})", line)
            if m:
                current_commit = m.group(1)
            continue
        if line.startswith("Author: "):
            m = re.match(r"^Author:\s+(.+?)\s+<", line)
            if m:
                current_author = m.group(1)
            continue
        if line.startswith("Date:"):
            parts = line[5:].strip().split()
            current_date = " ".join(parts[:5])
            continue
        if line.startswith("diff --git "):
            m = re.match(r"^diff --git a/(.+?) b/", line)
            if m:
                current_file = m.group(1)
            continue
        if line.startswith("+") and not line.startswith("+++"):
            added_line = line[1:]
            for sev, pname, pattern in rules:
                match = pattern.search(added_line)
                if match:
                    matched_text = match.group(0)
                    findings.append(
                        {
                            "severity": sev,
                            "type": pname,
                            "commit": current_commit[:8],
                            "file": current_file,
                            "author": current_author,
                            "date": current_date,
                            "matched": f"{matched_text[:8]}...REDACTED",
                        }
                    )
                    break

    proc.wait()

    if not findings:
        print("扫描完成，未发现密钥泄露风险。")
        return 0

    findings.sort(key=lambda item: SEVERITY_ORDER.get(item["severity"], 99))

    if args.format == "table":
        high_count = sum(1 for item in findings if item["severity"] == "HIGH")
        med_count = sum(1 for item in findings if item["severity"] == "MEDIUM")
        low_count = sum(1 for item in findings if item["severity"] == "LOW")
        print("=== 密钥泄露扫描报告 ===")
        print("")
        print(f"发现 {len(findings)} 处潜在泄露（HIGH: {high_count}, MEDIUM: {med_count}, LOW: {low_count}）")
        print("")
        print(f"{'严重度':<8}  {'类型':<22}  {'Commit':<10}  {'文件':<30}  {'作者':<16}  匹配内容")
        print(f"{'-' * 6:<8}  {'-' * 22}  {'-' * 8:<10}  {'-' * 30}  {'-' * 16}  {'-' * 8}")
        for item in findings:
            print(
                f"{item['severity']:<8}  {item['type']:<22}  {item['commit']:<10}  {item['file']:<30}  {item['author']:<16}  {item['matched']}"
            )
        print("")
        print("提示: 如果发现真实泄露，请立即轮换（rotate）对应的密钥或凭据。")
    elif args.format == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf, lineterminator="\n")
        writer.writerow(["severity", "type", "commit", "file", "author", "date", "matched"])
        for item in findings:
            writer.writerow(
                [
                    item["severity"],
                    item["type"],
                    item["commit"],
                    item["file"],
                    item["author"],
                    item["date"],
                    item["matched"],
                ]
            )
        sys.stdout.write(buf.getvalue())
    else:
        print(
            json.dumps(
                {"total_findings": len(findings), "findings": findings},
                ensure_ascii=False,
                indent=2,
            )
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
