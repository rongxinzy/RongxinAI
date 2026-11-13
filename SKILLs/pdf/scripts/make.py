#!/usr/bin/env python3
"""make.py — minimax-pdf unified CLI (cross-platform).

Usage: python3 make.py <command> [options]

Commands:
  check                          Verify all dependencies
  fix                            Auto-install missing dependencies
  run   --title T --type TYPE    Full pipeline -> output.pdf
        --out FILE               Output path (default: output.pdf)
        --author A --date D
        --subtitle S
        --abstract A             Optional abstract text for cover
        --cover-image URL        Optional cover image URL/path
        --content FILE           Path to content.json (optional)
  fill  --input form.pdf         Inspect or fill form fields
  reformat --input doc.md        Parse doc -> apply design -> PDF
  demo                           Build a full-featured demo to demo.pdf

Exit codes: 0 success, 1 usage error, 2 dep missing, 3 runtime error
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
PYTHON_DEPS = ("reportlab", "pypdf", "matplotlib", "pypdfium2", "pillow")


def find_python() -> str:
    return (
        os.environ.get("ZHIYUAN_SKILL_PYTHON_BIN")
        or os.environ.get("ZHIYUAN_PYTHON_BIN")
        or sys.executable
        or shutil.which("python3")
        or shutil.which("python")
        or "python3"
    )


def find_uv() -> str | None:
    return os.environ.get("ZHIYUAN_UV_BIN") or shutil.which("uv")


def resolve_node_command() -> tuple[str | None, dict[str, str]]:
    electron_path = os.environ.get("ZHIYUAN_ELECTRON_PATH", "").strip()
    if electron_path and Path(electron_path).is_file():
        return electron_path, {**os.environ, "ELECTRON_RUN_AS_NODE": "1"}
    node = shutil.which("node")
    if node:
        return node, dict(os.environ)
    return None, dict(os.environ)


def run_python(args: list[str], capture_output: bool = False) -> subprocess.CompletedProcess[str]:
    py = find_python()
    uv = find_uv()
    if os.environ.get("ZHIYUAN_SKILL_PYTHON_BIN") or not uv:
        cmd = [py, *args]
    else:
        # Use isolated uv context (`uv run --quiet --no-project --python ...`) instead of mutating base CPython.
        cmd = [uv, "run", "--quiet", "--no-project", "--python", py]
        for dep in PYTHON_DEPS:
            cmd.extend(["--with", dep])
        cmd.extend(["python", *args])
    return subprocess.run(
        cmd,
        capture_output=capture_output,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def run_node(args: list[str], capture_output: bool = False) -> subprocess.CompletedProcess[str]:
    node_cmd, env = resolve_node_command()
    if not node_cmd:
        raise RuntimeError("node runtime not found — cover rendering unavailable")
    return subprocess.run(
        [node_cmd, *args],
        env=env,
        capture_output=capture_output,
        text=True,
        encoding="utf-8",
        errors="replace",
    )


def cmd_check(_: list[str]) -> int:
    ok = True
    print("Checking dependencies...")

    py = find_python()
    try:
        ver_proc = subprocess.run([py, "--version"], capture_output=True, text=True, check=True)
        ver = (ver_proc.stdout or ver_proc.stderr).strip().split()[-1]
        print(f"  OK python {ver}")
    except Exception:
        print("  FAIL python not found")
        ok = False

    dep_proc = run_python(
        ["-c", "import reportlab, pypdf, matplotlib, pypdfium2, PIL"],
        capture_output=True,
    )
    if dep_proc.returncode == 0:
        uv_note = "managed by uv" if find_uv() else "python environment"
        print(f"  OK Python PDF dependencies ({uv_note})")
    else:
        print("  WARN Python PDF dependencies unavailable  (run: python3 make.py fix)")
        ok = False

    node_cmd, _ = resolve_node_command()
    if node_cmd:
        ver_proc = run_node(["--version"], capture_output=True)
        print(f"  OK node {ver_proc.stdout.strip()}")
    else:
        print("  FAIL node not found — cover rendering unavailable")
        ok = False

    if node_cmd:
        pw_check = run_node(
            [
                "-e",
                "try{require('playwright');}catch{require(require('child_process').execSync('npm root -g').toString().trim()+'/playwright');}",
            ],
            capture_output=True,
        )
        if pw_check.returncode == 0:
            print("  OK playwright")
        else:
            print("  WARN playwright not found  (run: python3 make.py fix)")
            ok = False

    if ok:
        print("\nAll dependencies satisfied.")
        return 0
    print("\nSome dependencies missing. Run: python3 make.py fix")
    return 2


def cmd_fix(_: list[str]) -> int:
    print("Installing missing dependencies...")
    rc = 0
    py = find_python()
    uv = find_uv()

    if uv:
        res = run_python(["-c", "import reportlab, pypdf, matplotlib, pypdfium2, PIL"])
        if res.returncode != 0:
            print("  WARN uv dependency setup failed")
            rc = 3
        else:
            print("  OK Python dependencies prepared by uv")
    else:
        res = subprocess.run(
            [py, "-m", "pip", "install", "-q", *PYTHON_DEPS],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        if res.returncode != 0:
            print("  WARN pip install failed — install reportlab pypdf matplotlib pypdfium2 pillow")
            rc = 3
        else:
            print("  OK Python packages installed")

    npm_cmd = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    npx_cmd = shutil.which("npx.cmd" if os.name == "nt" else "npx")
    if npm_cmd and npx_cmd:
        r1 = subprocess.run([npm_cmd, "install", "-g", "playwright", "--silent"])
        r2 = subprocess.run([npx_cmd, "playwright", "install", "chromium"])
        if r1.returncode == 0 and r2.returncode == 0:
            print("  OK Playwright + Chromium installed")
        else:
            print("  WARN playwright install failed — try manually")
            rc = 3
    else:
        print("  WARN npm not found — cannot install Playwright automatically")
        rc = rc or 2

    if rc == 0:
        print("\nAll dependencies installed. Run: python3 make.py check")
    return rc


def cmd_run(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="make.py run", add_help=False)
    parser.add_argument("--title", default="Untitled Document")
    parser.add_argument("--type", dest="doc_type", default="general")
    parser.add_argument("--author", default="")
    parser.add_argument("--date", default="")
    parser.add_argument("--subtitle", default="")
    parser.add_argument("--abstract", default="")
    parser.add_argument("--cover-image", default="")
    parser.add_argument("--accent", default="")
    parser.add_argument("--cover-bg", default="")
    parser.add_argument("--content", default="")
    parser.add_argument("--out", default="output.pdf")
    try:
        args, unknown = parser.parse_known_args(argv)
    except SystemExit:
        return 1
    if unknown:
        print(f"Unknown option: {unknown[0]}")
        return 1

    print(f"Building: {args.title}")
    print(f"  Type    : {args.doc_type}")
    print(f"  Output  : {args.out}")

    with tempfile.TemporaryDirectory() as workdir_str:
        workdir = Path(workdir_str)
        tokens_path = workdir / "tokens.json"

        print("\nStep 1/4  Generating design tokens...")
        palette_args = [
            str(SCRIPTS / "palette.py"),
            "--title",
            args.title,
            "--type",
            args.doc_type,
            "--author",
            args.author,
            "--date",
            args.date,
            "--out",
            str(tokens_path),
        ]
        if args.accent:
            palette_args.extend(["--accent", args.accent])
        if args.cover_bg:
            palette_args.extend(["--cover-bg", args.cover_bg])

        p1 = run_python(palette_args)
        if p1.returncode != 0:
            return p1.returncode or 3

        tokens = json.loads(tokens_path.read_text(encoding="utf-8"))
        if args.abstract or args.cover_image:
            if args.abstract:
                tokens["abstract"] = args.abstract
            if args.cover_image:
                tokens["cover_image"] = args.cover_image
            tokens_path.write_text(json.dumps(tokens, indent=2), encoding="utf-8")

        print(f"  Mood    : {tokens.get('mood', '')}")
        print(f"  Pattern : {tokens.get('cover_pattern', '')}")
        print(f"  Fonts   : {tokens.get('font_display', '')} / {tokens.get('font_body', '')}")

        print("\nStep 2/4  Rendering cover...")
        cover_html = workdir / "cover.html"
        cover_pdf = workdir / "cover.pdf"
        cover_args = [
            str(SCRIPTS / "cover.py"),
            "--tokens",
            str(tokens_path),
            "--out",
            str(cover_html),
        ]
        if args.subtitle:
            cover_args.extend(["--subtitle", args.subtitle])

        p2 = run_python(cover_args)
        if p2.returncode != 0:
            return p2.returncode or 3

        p2b = run_node([str(SCRIPTS / "render_cover.js"), "--input", str(cover_html), "--out", str(cover_pdf)])
        if p2b.returncode != 0:
            return p2b.returncode or 3
        print("  OK Cover rendered")

        print("\nStep 3/4  Rendering body pages...")
        content_file = args.content
        if not content_file:
            placeholder = workdir / "content.json"
            placeholder.write_text(
                json.dumps(
                    [
                        {"type": "h1", "text": "Document Body"},
                        {"type": "body", "text": "Replace this with your content.json file using --content path/to/content.json"},
                        {"type": "body", "text": "See the content.json schema in the skill README for supported block types."},
                    ],
                    indent=2,
                ),
                encoding="utf-8",
            )
            content_file = str(placeholder)
            print("  No content file provided — using placeholder body.")

        body_pdf = workdir / "body.pdf"
        p3 = run_python(
            [
                str(SCRIPTS / "render_body.py"),
                "--tokens",
                str(tokens_path),
                "--content",
                content_file,
                "--out",
                str(body_pdf),
            ]
        )
        if p3.returncode != 0:
            return p3.returncode or 3
        print("  OK Body rendered")

        print("\nStep 4/4  Merging PDF...")
        p4 = run_python(
            [
                str(SCRIPTS / "merge.py"),
                "--cover",
                str(cover_pdf),
                "--body",
                str(body_pdf),
                "--out",
                args.out,
                "--title",
                args.title,
            ]
        )
        return p4.returncode


def cmd_fill(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="make.py fill", add_help=False)
    parser.add_argument("--input", default="")
    parser.add_argument("--out", default="")
    parser.add_argument("--values", default="")
    parser.add_argument("--data", default="")
    parser.add_argument("--inspect", action="store_true")
    try:
        args, unknown = parser.parse_known_args(argv)
    except SystemExit:
        return 1
    if unknown:
        print(f"Unknown option: {unknown[0]}")
        return 1

    if not args.input:
        print("Usage: make.py fill --input form.pdf [--out filled.pdf] [--values '{...}'] [--data values.json] [--inspect]")
        return 1

    if args.inspect or (not args.out and not args.values and not args.data):
        print(f"Inspecting form fields in: {args.input}")
        return run_python([str(SCRIPTS / "fill_inspect.py"), "--input", args.input]).returncode

    print(f"Filling form: {args.input} -> {args.out}")
    fill_args = [str(SCRIPTS / "fill_write.py"), "--input", args.input, "--out", args.out]
    if args.values:
        fill_args.extend(["--values", args.values])
    if args.data:
        fill_args.extend(["--data", args.data])
    return run_python(fill_args).returncode


def cmd_reformat(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="make.py reformat", add_help=False)
    parser.add_argument("--input", default="")
    parser.add_argument("--title", default="Reformatted Document")
    parser.add_argument("--type", dest="doc_type", default="general")
    parser.add_argument("--author", default="")
    parser.add_argument("--date", default="")
    parser.add_argument("--subtitle", default="")
    parser.add_argument("--out", default="output.pdf")
    try:
        args, unknown = parser.parse_known_args(argv)
    except SystemExit:
        return 1
    if unknown:
        print(f"Unknown option: {unknown[0]}")
        return 1

    if not args.input:
        print("Usage: make.py reformat --input source.md --title T --type TYPE --out output.pdf")
        return 1

    with tempfile.TemporaryDirectory() as tmpdir_str:
        content_json = Path(tmpdir_str) / "content.json"
        print(f"Parsing: {args.input}")
        parse_res = run_python(
            [str(SCRIPTS / "reformat_parse.py"), "--input", args.input, "--out", str(content_json)]
        )
        if parse_res.returncode != 0:
            return parse_res.returncode or 3
        print("  OK Parsed to content.json")
        print("Applying design and building PDF...")
        run_args = [
            "--title",
            args.title,
            "--type",
            args.doc_type,
            "--author",
            args.author,
            "--date",
            args.date,
            "--content",
            str(content_json),
            "--out",
            args.out,
        ]
        if args.subtitle:
            run_args.extend(["--subtitle", args.subtitle])
        return cmd_run(run_args)


def cmd_demo(_: list[str]) -> int:
    demo_blocks = [
        {"type": "h1", "text": "Executive Summary"},
        {
            "type": "body",
            "text": "This document was generated by minimax-pdf — a skill for creating visually polished PDFs. Every design decision is rooted in the document type and content, not a generic template.",
        },
        {
            "type": "callout",
            "text": "Key insight: design tokens flow from palette.py through every renderer, keeping cover and body visually consistent.",
        },
        {"type": "h1", "text": "How It Works"},
        {"type": "h2", "text": "The Token Pipeline"},
        {
            "type": "body",
            "text": "The palette.py script infers a color palette and typography pair from the document type. These tokens are written to tokens.json and consumed by every downstream script.",
        },
        {"type": "numbered", "text": "palette.py generates color tokens, font selection, and the cover pattern"},
        {"type": "numbered", "text": "cover.py renders the cover HTML using the selected pattern"},
        {"type": "numbered", "text": "render_cover.js uses Playwright to convert the HTML cover to PDF"},
        {"type": "numbered", "text": "render_body.py builds inner pages from content.json using ReportLab"},
        {"type": "numbered", "text": "merge.py combines cover + body into the final PDF"},
        {"type": "h2", "text": "Cover Patterns"},
        {
            "type": "table",
            "headers": ["Pattern", "Document type", "Visual character"],
            "rows": [
                ["fullbleed", "report, general", "Deep background · dot-grid texture"],
                ["split", "proposal", "Left dark panel · right dot-grid"],
                ["typographic", "resume, academic", "Oversized display type · first-word accent"],
                ["atmospheric", "portfolio", "Dark bg · radial glow · dot-grid"],
                ["magazine", "magazine", "Cream bg · centered · hero image"],
                ["darkroom", "darkroom", "Navy bg · centered · grayscale image"],
                ["terminal", "terminal", "Near-black · grid lines · monospace"],
                ["poster", "poster", "White · thick sidebar · oversized title"],
            ],
        },
        {"type": "h1", "text": "Data Visualisation"},
        {"type": "h2", "text": "Performance Metrics (Chart)"},
        {
            "type": "body",
            "text": "Charts are rendered natively using matplotlib with a color palette derived from the document accent. No external chart services or image files required.",
        },
        {
            "type": "chart",
            "chart_type": "bar",
            "title": "Quarterly Performance",
            "labels": ["Q1", "Q2", "Q3", "Q4"],
            "datasets": [
                {"label": "Revenue", "values": [120, 145, 132, 178]},
                {"label": "Expenses", "values": [95, 108, 99, 122]},
            ],
            "y_label": "USD (thousands)",
            "caption": "Quarterly revenue vs. expenses",
        },
        {"type": "pagebreak"},
        {
            "type": "bibliography",
            "title": "References",
            "items": [
                {"id": "1", "text": "Bringhurst, R. (2004). The Elements of Typographic Style (3rd ed.). Hartley & Marks."},
                {"id": "2", "text": "Cairo, A. (2016). The Truthful Art: Data, Charts, and Maps for Communication. New Riders."},
                {"id": "3", "text": "Hochuli, J. & Kinross, R. (1996). Designing Books: Practice and Theory. Hyphen Press."},
            ],
        },
    ]

    with tempfile.TemporaryDirectory() as tmpdir_str:
        content_path = Path(tmpdir_str) / "content.json"
        content_path.write_text(json.dumps(demo_blocks, indent=2), encoding="utf-8")
        return cmd_run(
            [
                "--title",
                "minimax-pdf demo",
                "--type",
                "report",
                "--author",
                "minimax-pdf skill",
                "--date",
                datetime.now().strftime("%B %Y"),
                "--subtitle",
                "A demonstration of the token-based design pipeline",
                "--content",
                str(content_path),
                "--out",
                "demo.pdf",
            ]
        )


def print_usage() -> None:
    print("minimax-pdf — make.py\n")
    print("Usage: python3 make.py <command> [options]\n")
    print("Commands:")
    print("  check                             Verify all dependencies")
    print("  fix                               Auto-install missing deps")
    print("  run    --title T --type TYPE      CREATE: full pipeline -> PDF")
    print("         [--author A] [--date D] [--subtitle S]")
    print("         [--abstract A] [--cover-image URL]")
    print("         [--accent #HEX] [--cover-bg #HEX]")
    print("         [--content content.json] [--out output.pdf]")
    print("  fill   --input f.pdf              FILL: inspect or fill form fields")
    print("  reformat --input doc.md           REFORMAT: parse doc -> apply design -> PDF")
    print("  demo                              Build a full-featured demo PDF")


def main() -> int:
    if len(sys.argv) < 2 or sys.argv[1] in ("-h", "--help"):
        print_usage()
        return 0

    command = sys.argv[1]
    rest = sys.argv[2:]
    handlers = {
        "check": cmd_check,
        "fix": cmd_fix,
        "run": cmd_run,
        "fill": cmd_fill,
        "reformat": cmd_reformat,
        "demo": cmd_demo,
    }
    handler = handlers.get(command)
    if handler is None:
        print(f"Unknown command: {command}")
        return 1
    return handler(rest)


if __name__ == "__main__":
    raise SystemExit(main())
